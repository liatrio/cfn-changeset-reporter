const core = require('@actions/core');
const { CloudFormation } = require('@aws-sdk/client-cloudformation');

async function run() {
  try {
    // Get inputs from action
    const awsRegion = core.getInput('aws-region', { required: true });
    const stackName = core.getInput('stack-name', { required: true });
    const changesetName = core.getInput('changeset-name');

    // Create CloudFormation client using AWS SDK v3
    const cloudformation = new CloudFormation({
      region: awsRegion
    });

    // If changeset name is not specified, get the latest one for the stack
    let actualChangesetName = changesetName;
    if (!actualChangesetName) {
      core.info('No changeset name provided, finding the latest one...');
      const listResult = await cloudformation.listChangeSets({ StackName: stackName });
      
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
    
    const changeset = await cloudformation.describeChangeSet(params);
    
    // Generate report based on output format
    let report;
    
    report = generateMarkdownReport(changeset);
    
    // Print the report line by line for better readability in GitHub Actions logs
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


function generateMarkdownReport(changeset) {
  let report = `CloudFormation Changeset Report\n\n`;
  
  const changes = changeset.Changes || [];
  const totalCount = changes.length;
  
  // Group resources by replacement status
  const replacementGroups = {
    'Will be replaced': [],
    'Modified without replacement': [],
    'New resources': [],
    'Removed resources': []
  };
  
  // Process and categorize each change
  changes.forEach((change, i) => {
    const resource = change.ResourceChange;
    const needsReplacement = resource.Replacement === 'True' || resource.Replacement === 'Conditional';
    const isAdd = resource.Action === 'Add';
    const isRemove = resource.Action === 'Remove';
    
    // Determine color based on action and replacement
    let color;
    if (isRemove) {
      color = 'darkred';
      replacementGroups['Removed resources'].push({ index: i+1, resource, change });
    } else if (needsReplacement) {
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
  
  report += `\x1b[97m\x1b[1m── Changes Summary (${totalCount}) ──\x1b[0m\n\n`;
  
  // Create summary with counts
  report += `⛔ \x1b[31mResources to be removed:\x1b[0m ${replacementGroups['Removed resources'].length}  \n`;
  report += `🔴 \x1b[91mResources requiring replacement:\x1b[0m ${replacementGroups['Will be replaced'].length}  \n`;
  report += `🟡 \x1b[93mResources modified in-place:\x1b[0m ${replacementGroups['Modified without replacement'].length}  \n`;
  report += `🟢 \x1b[92mNew resources to be created:\x1b[0m ${replacementGroups['New resources'].length}  \n\n`;
  
  // Create a complete table with all changes
  if (totalCount > 0) {
    report += `\x1b[97m\x1b[1m── All Changes ──\x1b[0m\n\n`;
    
    // Calculate the maximum width for each column based on content
    const colWidths = {
      'Resource': 'Resource'.length,
      'Type': 'Type'.length,
      'Action': 'Action'.length,
      'Replacement': 'Replacement'.length
    };
    
    // Check all rows to determine max widths (except # which is fixed)
    changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      const resourceWidth = resource.LogicalResourceId.length + 2; // +2 for the emoji and space
      const typeWidth = resource.ResourceType.length;
      const actionWidth = resource.Action.length;
      const replacementWidth = (resource.Replacement || 'N/A').length;
      
      // Update max widths
      colWidths['Resource'] = Math.max(colWidths['Resource'], resourceWidth);
      colWidths['Type'] = Math.max(colWidths['Type'], typeWidth);
      colWidths['Action'] = Math.max(colWidths['Action'], actionWidth);
      colWidths['Replacement'] = Math.max(colWidths['Replacement'], replacementWidth);
    });
    
    // Add extra padding for each column
    const padding = 2;
    Object.keys(colWidths).forEach(key => {
      colWidths[key] += padding;
    });
    
    // Create header row with appropriate widths - fixed index column with exactly one space on each side
    report += `\x1b[97m| # | ${'Resource'.padEnd(colWidths['Resource'])} | ${'Type'.padEnd(colWidths['Type'])} | ${'Action'.padEnd(colWidths['Action'])} | ${'Replacement'.padEnd(colWidths['Replacement'])} |\x1b[0m\n`;
    
    // Create separator row (4 dashes for index including the spaces)
    report += `\x1b[97m| - | ${'-'.repeat(colWidths['Resource'])} | ${'-'.repeat(colWidths['Type'])} | ${'-'.repeat(colWidths['Action'])} | ${'-'.repeat(colWidths['Replacement'])} |\x1b[0m\n`;
    
    // Create data rows with appropriate widths
    changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      const color = resource._color;
      let colorEmoji = '⚪';
      let textColorCode = '';
      
      if (color === 'darkred') {
        colorEmoji = '⛔';
        textColorCode = '\x1b[31m'; // Darker red for removals
      } else if (color === 'red') {
        colorEmoji = '🔴'; 
        textColorCode = '\x1b[91m'; // Bright red for replacements
      } else if (color === 'yellow') {
        colorEmoji = '🟡';
        textColorCode = '\x1b[93m';
      } else if (color === 'green') {
        colorEmoji = '🟢';
        textColorCode = '\x1b[92m';
      }
      
      // Format each cell with proper width (fixed index column with exactly one space on each side)
      const resourceCell = `${colorEmoji} ${textColorCode}${resource.LogicalResourceId}\x1b[0m`.padEnd(colWidths['Resource'] + 9); // +9 to account for color code chars
      const typeCell = resource.ResourceType.padEnd(colWidths['Type']);
      const actionCell = `${textColorCode}${resource.Action}\x1b[0m`.padEnd(colWidths['Action'] + 9);
      
      // Special handling for the Replacement column
      let replacementText = resource.Replacement || 'N/A';
      const replacementCell = `${textColorCode}${replacementText}\x1b[0m`.padEnd(colWidths['Replacement'] + 9);
      
      report += `\x1b[97m| ${i+1} |\x1b[0m ${resourceCell} \x1b[97m|\x1b[0m ${typeCell} \x1b[97m|\x1b[0m ${actionCell} \x1b[97m|\x1b[0m ${replacementCell} \x1b[97m|\x1b[0m\n`;
    });
    
    // Create detailed sections by replacement type
    if (replacementGroups['Will be replaced'].length > 0) {
      report += `\n\n\x1b[91m\x1b[1m🔴 Resources Requiring Replacement\x1b[0m (${replacementGroups['Will be replaced'].length})\n\n`;
      
      replacementGroups['Will be replaced'].forEach(({ resource, change }, localIndex) => {
        report += `   \x1b[1m${localIndex + 1}.\x1b[0m \x1b[91m${resource.LogicalResourceId}\x1b[0m (\x1b[90m${resource.ResourceType}\x1b[0m)\n`;
        report += `     • \x1b[97mAction:\x1b[0m \x1b[91m${resource.Action}\x1b[0m\n`;
        report += `     • \x1b[97mReplacement:\x1b[0m \x1b[91m${resource.Replacement}\x1b[0m\n`;
        
        // Highlight what's causing the replacement
        report += `     • \x1b[1m\x1b[97m⚠️ Replacement Reason:\x1b[0m\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          const replacementCauses = resource.Details.filter(detail => 
            detail.Evaluation === 'Dynamic' || 
            detail.Target.RequiresRecreation === 'Always' ||
            detail.Target.RequiresRecreation === 'Conditionally'
          );
          
          if (replacementCauses.length > 0) {
            replacementCauses.forEach(detail => {
              report += `       - Property \x1b[97m\`${detail.Target.Name}\`\x1b[0m requires recreation \x1b[91m(${detail.Target.RequiresRecreation})\x1b[0m\n`;
            });
          } else {
            report += `       - \x1b[91mImplicit replacement due to dependent resource changes\x1b[0m\n`;
          }
        }
        
        if (resource.Details && resource.Details.length > 0) {
          report += `\n     • \x1b[97mAll Property Changes:\x1b[0m\n`;
          resource.Details.forEach(detail => {
            const isReplacementCause = detail.Target.RequiresRecreation === 'Always' || 
                                     detail.Target.RequiresRecreation === 'Conditionally';
            const prefix = isReplacementCause ? '⚠️ ' : '';
            const nameColor = isReplacementCause ? '\x1b[91m' : '\x1b[97m';
            report += `       - ${prefix}${nameColor}${detail.Target.Name}:\x1b[0m ${detail.ChangeSource} (\x1b[90m${detail.Target.Attribute}\x1b[0m)\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // Modified resources section
    if (replacementGroups['Modified without replacement'].length > 0) {
      report += `\n\n\x1b[93m\x1b[1m🟡 Resources Modified In-Place\x1b[0m (${replacementGroups['Modified without replacement'].length})\n\n`;
      
      replacementGroups['Modified without replacement'].forEach(({ resource, change }, localIndex) => {
        report += `   \x1b[1m${localIndex + 1}.\x1b[0m \x1b[93m${resource.LogicalResourceId}\x1b[0m (\x1b[90m${resource.ResourceType}\x1b[0m)\n`;
        report += `     • \x1b[97mAction:\x1b[0m \x1b[93m${resource.Action}\x1b[0m\n`;
        report += `     • \x1b[97mReplacement:\x1b[0m ${resource.Replacement || 'N/A'}\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          report += `     • \x1b[97mProperty Changes:\x1b[0m\n`;
          resource.Details.forEach(detail => {
            report += `       - \x1b[93m${detail.Target.Name}:\x1b[0m ${detail.ChangeSource} (\x1b[90m${detail.Target.Attribute}\x1b[0m)\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // New resources section
    if (replacementGroups['New resources'].length > 0) {
      report += `\n\n\x1b[92m\x1b[1m🟢 New Resources\x1b[0m (${replacementGroups['New resources'].length})\n\n`;
      
      replacementGroups['New resources'].forEach(({ resource, change }, localIndex) => {
        report += `   \x1b[1m${localIndex + 1}.\x1b[0m \x1b[92m${resource.LogicalResourceId}\x1b[0m (\x1b[90m${resource.ResourceType}\x1b[0m)\n`;
        report += `     • \x1b[97mAction:\x1b[0m \x1b[92m${resource.Action}\x1b[0m\n`;
        
        // For new resources, we might not have details but can include them if available
        if (resource.Details && resource.Details.length > 0) {
          report += `     • \x1b[97mProperty Details:\x1b[0m\n`;
          resource.Details.forEach(detail => {
            report += `       - \x1b[92m${detail.Target.Name}:\x1b[0m ${detail.ChangeSource} (\x1b[90m${detail.Target.Attribute}\x1b[0m)\n`;
          });
        }
        
        report += '\n';
      });
    }
    
    // Removed resources section
    if (replacementGroups['Removed resources'].length > 0) {
      report += `\n\n\x1b[31m\x1b[1m⛔ Resources Being Removed\x1b[0m (${replacementGroups['Removed resources'].length})\n\n`;
      
      replacementGroups['Removed resources'].forEach(({ resource, change }, localIndex) => {
        report += `   \x1b[1m${localIndex + 1}.\x1b[0m \x1b[31m${resource.LogicalResourceId}\x1b[0m (\x1b[90m${resource.ResourceType}\x1b[0m)\n`;
        report += `     • \x1b[97mAction:\x1b[0m \x1b[31m${resource.Action}\x1b[0m\n`;
        
        // For removed resources, show any available details
        if (resource.Details && resource.Details.length > 0) {
          report += `     • \x1b[97mResource Details:\x1b[0m\n`;
          resource.Details.forEach(detail => {
            report += `       - \x1b[31m${detail.Target.Name}:\x1b[0m ${detail.ChangeSource} (\x1b[90m${detail.Target.Attribute}\x1b[0m)\n`;
          });
        }
        
        report += `     • \x1b[97m\x1b[1m⚠️ Warning:\x1b[0m This resource will be \x1b[31mPERMANENTLY DELETED\x1b[0m\n`;
        report += '\n';
      });
    }
  } else {
    report += 'No changes detected.\n';
  }
  
  return report;
}

// Export for testing
module.exports = { run };

// Run if this is the main module
if (require.main === module) {
  run();
}
