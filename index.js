const core = require('@actions/core');
const AWS = require('aws-sdk');

async function run() {
  try {
    // Get inputs from action
    const awsRegion = core.getInput('aws-region', { required: true });
    const stackName = core.getInput('stack-name', { required: true });
    const changesetName = core.getInput('changeset-name');
    const outputFormat = core.getInput('output-format') || 'markdown';
    // const outputFile = core.getInput('output-file');

    // const awsRegion = "us-east-2";
    // const stackName = "SC-015451699691-pp-lfi2taor2qupk";
    // const changesetName = "";
    // const outputFormat = "markdown";
    // const outputFile = "output.txt";

    // Configure AWS SDK
    AWS.config.update({ region: awsRegion });
    const cloudformation = new AWS.CloudFormation();

    // If changeset name is not specified, get the latest one for the stack
    let actualChangesetName = changesetName;
    if (!actualChangesetName) {
      core.info('No changeset name provided, finding the latest one...');
      const listResult = await cloudformation.listChangeSets({ StackName: stackName }).promise();
      
      if (listResult.Summaries && listResult.Summaries.length > 0) {
        // Sort by creation time, get the most recent
        listResult.Summaries.sort((a, b) => 
          new Date(b.CreationTime) - new Date(a.CreationTime)
        );
        actualChangesetName = listResult.Summaries[0].ChangeSetName;
        core.info(`Using latest changeset: ${actualChangesetName}`);
      } else {
        throw new Error(`No changesets found for stack ${stackName}`);
      }
    }

    // Get changeset details
    const params = {
      ChangeSetName: actualChangesetName,
      StackName: stackName
    };
    
    const changeset = await cloudformation.describeChangeSet(params).promise();
    
    // Generate report based on output format
    let report;
    switch(outputFormat.toLowerCase()) {
      case 'json':
        report = JSON.stringify(changeset, null, 2);
        break;
      case 'text':
        report = generateTextReport(changeset);
        break;
      case 'markdown':
      default:
        report = generateMarkdownReport(changeset);
    }
    
    // Output the report to console
    core.info('CloudFormation Changeset Report:');
    
    // For multiline reports, split by newline and log each line separately for better readability in GitHub Actions logs
    const reportLines = report.split('\n');
    reportLines.forEach(line => {
      core.info(line);
    });
    
    // Set output for other actions to use
    core.setOutput('report', report);
    core.setOutput('changeset-name', actualChangesetName);
    core.setOutput('changeset-status', changeset.Status);
    
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

function generateTextReport(changeset) {
  let report = '--- CloudFormation Changeset Report ---\n\n';
  
  report += `Stack: ${changeset.StackName}\n`;
  report += `Changeset: ${changeset.ChangeSetName}\n`;
  report += `Status: ${changeset.Status} (${changeset.StatusReason || 'No reason provided'})\n`;
  report += `Created: ${changeset.CreationTime}\n\n`;
  
  const changes = changeset.Changes || [];
  const totalCount = changes.length;
  
  // Group resources by replacement status
  const replacementGroups = {
    'RESOURCES REQUIRING REPLACEMENT': [],
    'RESOURCES MODIFIED IN-PLACE': [],
    'NEW RESOURCES': []
  };
  
  // Process and categorize each change
  changes.forEach((change, i) => {
    const resource = change.ResourceChange;
    const needsReplacement = resource.Replacement === 'True' || resource.Replacement === 'Conditional';
    const isAdd = resource.Action === 'Add';
    
    if (needsReplacement) {
      replacementGroups['RESOURCES REQUIRING REPLACEMENT'].push({ index: i+1, resource, change });
    } else if (isAdd) {
      replacementGroups['NEW RESOURCES'].push({ index: i+1, resource, change });
    } else {
      replacementGroups['RESOURCES MODIFIED IN-PLACE'].push({ index: i+1, resource, change });
    }
  });
  
  report += `Changes Summary (${totalCount}):\n\n`;
  report += `* Resources requiring replacement: ${replacementGroups['RESOURCES REQUIRING REPLACEMENT'].length}\n`;
  report += `* Resources modified in-place: ${replacementGroups['RESOURCES MODIFIED IN-PLACE'].length}\n`;
  report += `* New resources to be created: ${replacementGroups['NEW RESOURCES'].length}\n\n`;
  
  if (totalCount > 0) {
    // First list resources requiring replacement
    if (replacementGroups['RESOURCES REQUIRING REPLACEMENT'].length > 0) {
      report += '=== RESOURCES REQUIRING REPLACEMENT ===\n\n';
      
      replacementGroups['RESOURCES REQUIRING REPLACEMENT'].forEach(({ index, resource, change }) => {
        report += `${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        report += `   Action: ${resource.Action}\n`;
        report += `   Replacement: ${resource.Replacement}\n`;
        
        // Highlight what's causing the replacement
        report += `   Replacement Reason:\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          const replacementCauses = resource.Details.filter(detail => 
            detail.Evaluation === 'Dynamic' || 
            detail.Target.RequiresRecreation === 'Always' ||
            detail.Target.RequiresRecreation === 'Conditionally'
          );
          
          if (replacementCauses.length > 0) {
            replacementCauses.forEach(detail => {
              report += `     - Property '${detail.Target.Name}' requires recreation when changed (${detail.Target.RequiresRecreation})\n`;
            });
          } else {
            report += `     - Implicit replacement due to dependent resource changes\n`;
          }
        }
        
        if (resource.Details && resource.Details.length > 0) {
          report += '   All Property Changes:\n';
          resource.Details.forEach(detail => {
            const isReplacementCause = detail.Target.RequiresRecreation === 'Always' || 
                                    detail.Target.RequiresRecreation === 'Conditionally';
            const marker = isReplacementCause ? '! ' : '- ';
            report += `     ${marker}${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // List modified resources
    if (replacementGroups['RESOURCES MODIFIED IN-PLACE'].length > 0) {
      report += '=== RESOURCES MODIFIED IN-PLACE ===\n\n';
      
      replacementGroups['RESOURCES MODIFIED IN-PLACE'].forEach(({ index, resource, change }) => {
        report += `${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        report += `   Action: ${resource.Action}\n`;
        report += `   Replacement: ${resource.Replacement || 'N/A'}\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          report += '   Property Changes:\n';
          resource.Details.forEach(detail => {
            report += `     - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // List new resources
    if (replacementGroups['NEW RESOURCES'].length > 0) {
      report += '=== NEW RESOURCES ===\n\n';
      
      replacementGroups['NEW RESOURCES'].forEach(({ index, resource, change }) => {
        report += `${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        report += `   Action: ${resource.Action}\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          report += '   Property Details:\n';
          resource.Details.forEach(detail => {
            report += `     - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
  } else {
    report += 'No changes detected.\n';
  }
  
  return report;
}

function generateMarkdownReport(changeset) {
  let report = `# CloudFormation Changeset Report\n\n`;
  
  report += `**Stack:** ${changeset.StackName}  \n`;
  report += `**Changeset:** ${changeset.ChangeSetName}  \n`;
  report += `**Status:** ${changeset.Status} (${changeset.StatusReason || 'No reason provided'})  \n`;
  report += `**Created:** ${changeset.CreationTime}  \n\n`;
  
  const changes = changeset.Changes || [];
  const totalCount = changes.length;
  
  // Group resources by replacement status
  const replacementGroups = {
    'Will be replaced': [],
    'Modified without replacement': [],
    'New resources': []
  };
  
  // Process and categorize each change
  changes.forEach((change, i) => {
    const resource = change.ResourceChange;
    const needsReplacement = resource.Replacement === 'True' || resource.Replacement === 'Conditional';
    const isAdd = resource.Action === 'Add';
    
    // Determine color based on action and replacement
    let color;
    if (needsReplacement) {
      color = 'red';
      replacementGroups['Will be replaced'].push({ index: i+1, resource, change });
    } else if (isAdd) {
      color = 'green';
      replacementGroups['New resources'].push({ index: i+1, resource, change });
    } else {
      color = 'yellow';
      replacementGroups['Modified without replacement'].push({ index: i+1, resource, change });
    }
    
    // Add color data to the resource for later use
    resource._color = color;
  });
  
  report += `## Changes Summary (${totalCount})\n\n`;
  
  // Create summary with counts
  report += `- 🔴 **Resources requiring replacement:** ${replacementGroups['Will be replaced'].length}  \n`;
  report += `- 🟡 **Resources modified in-place:** ${replacementGroups['Modified without replacement'].length}  \n`;
  report += `- 🟢 **New resources to be created:** ${replacementGroups['New resources'].length}  \n\n`;
  
  // Create a complete table with all changes
  if (totalCount > 0) {
    report += `## All Changes\n\n`;
    report += `| # | Resource | Type | Action | Replacement |\n`;
    report += `|---|----------|------|--------|-------------|\n`;
    
    changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      const color = resource._color;
      let colorEmoji = '⚪';
      
      if (color === 'red') colorEmoji = '🔴';
      else if (color === 'yellow') colorEmoji = '🟡';
      else if (color === 'green') colorEmoji = '🟢';
      
      report += `| ${i+1} | ${colorEmoji} ${resource.LogicalResourceId} | ${resource.ResourceType} | ${resource.Action} | ${resource.Replacement || 'N/A'} |\n`;
    });
    
    // Create detailed sections by replacement type
    if (replacementGroups['Will be replaced'].length > 0) {
      report += `\n\n## 🔴 Resources Requiring Replacement (${replacementGroups['Will be replaced'].length})\n\n`;
      
      replacementGroups['Will be replaced'].forEach(({ index, resource, change }) => {
        report += `### ${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n\n`;
        report += `- **Action:** ${resource.Action}\n`;
        report += `- **Replacement:** ${resource.Replacement}\n`;
        
        // Highlight what's causing the replacement
        report += `- **⚠️ Replacement Reason:**\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          const replacementCauses = resource.Details.filter(detail => 
            detail.Evaluation === 'Dynamic' || 
            detail.Target.RequiresRecreation === 'Always' ||
            detail.Target.RequiresRecreation === 'Conditionally'
          );
          
          if (replacementCauses.length > 0) {
            replacementCauses.forEach(detail => {
              report += `  - Property \`${detail.Target.Name}\` requires recreation when changed (${detail.Target.RequiresRecreation})\n`;
            });
          } else {
            report += `  - Implicit replacement due to dependent resource changes\n`;
          }
        }
        
        if (resource.Details && resource.Details.length > 0) {
          report += '\n- **All Property Changes:**\n';
          resource.Details.forEach(detail => {
            const isReplacementCause = detail.Target.RequiresRecreation === 'Always' || 
                                     detail.Target.RequiresRecreation === 'Conditionally';
            const prefix = isReplacementCause ? '⚠️ ' : '';
            report += `  - ${prefix}${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // Modified resources section
    if (replacementGroups['Modified without replacement'].length > 0) {
      report += `\n\n## 🟡 Resources Modified In-Place (${replacementGroups['Modified without replacement'].length})\n\n`;
      
      replacementGroups['Modified without replacement'].forEach(({ index, resource, change }) => {
        report += `### ${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n\n`;
        report += `- **Action:** ${resource.Action}\n`;
        report += `- **Replacement:** ${resource.Replacement || 'N/A'}\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          report += '- **Property Changes:**\n';
          resource.Details.forEach(detail => {
            report += `  - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // New resources section
    if (replacementGroups['New resources'].length > 0) {
      report += `\n\n## 🟢 New Resources (${replacementGroups['New resources'].length})\n\n`;
      
      replacementGroups['New resources'].forEach(({ index, resource, change }) => {
        report += `### ${index}. ${resource.LogicalResourceId} (${resource.ResourceType})\n\n`;
        report += `- **Action:** ${resource.Action}\n`;
        
        // For new resources, we might not have details but can include them if available
        if (resource.Details && resource.Details.length > 0) {
          report += '- **Property Details:**\n';
          resource.Details.forEach(detail => {
            report += `  - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        report += '\n';
      });
    }
  } else {
    report += 'No changes detected.\n';
  }
  
  return report;
}

run();
