const core = require('@actions/core');
const AWS = require('aws-sdk');

async function run() {
  try {
    // Get inputs from action
    const awsRegion = core.getInput('aws-region', { required: true });
    const stackName = core.getInput('stack-name', { required: true });
    const changesetName = core.getInput('changeset-name');
    const outputFormat = core.getInput('output-format') || 'markdown';
    const outputFile = core.getInput('output-file');

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
    
    // Output the report
    if (outputFile) {
      const fs = require('fs');
      fs.writeFileSync(outputFile, report);
      core.info(`Report written to ${outputFile}`);
    } else {
      core.info('CloudFormation Changeset Report:');
      core.info(report);
    }
    
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
  
  report += `Changes (${changeset.Changes ? changeset.Changes.length : 0}):\n`;
  
  if (changeset.Changes && changeset.Changes.length > 0) {
    changeset.Changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      report += `\n${i+1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
      report += `   Action: ${resource.Action}\n`;
      report += `   Replacement: ${resource.Replacement || 'N/A'}\n`;
      
      if (resource.Details && resource.Details.length > 0) {
        report += '   Details:\n';
        resource.Details.forEach(detail => {
          report += `     - ${detail.ChangeSource}: ${detail.Target.Name} = ${detail.Target.Attribute}\n`;
        });
      }
    });
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
  
  report += `## Changes (${changeset.Changes ? changeset.Changes.length : 0})\n\n`;
  
  if (changeset.Changes && changeset.Changes.length > 0) {
    report += `| # | Resource | Type | Action | Replacement |\n`;
    report += `|---|----------|------|--------|-------------|\n`;
    
    changeset.Changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      report += `| ${i+1} | ${resource.LogicalResourceId} | ${resource.ResourceType} | ${resource.Action} | ${resource.Replacement || 'N/A'} |\n`;
    });
    
    report += '\n\n## Detailed Changes\n\n';
    
    changeset.Changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      report += `### ${i+1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n\n`;
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
  } else {
    report += 'No changes detected.\n';
  }
  
  return report;
}

run();
