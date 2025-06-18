const core = require('@actions/core');
const github = require('@actions/github');

const { CloudFormation } = require('@aws-sdk/client-cloudformation');

async function run() {
  try {
    // Get inputs from action
    const awsRegion = core.getInput('aws-region', { required: true });
    const stackName = core.getInput('stack-name', { required: true });
    const changesetName = core.getInput('changeset-name');
    const context = github.context;
    // Create CloudFormation client using AWS SDK v3
    const cloudformation = new CloudFormation({
      region: awsRegion
    });

    core.info(`Event Name: ${context.eventName}`);
    core.info(`Stack Name: ${stackName}`);

    // If changeset name is not specified, get the latest one for the stack
    let actualChangesetName = changesetName;
    let noChangesetFound = false;
    
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
        core.warning(`No changesets found for stack ${stackName}`);
        noChangesetFound = true;
      }
    }

    // Initialize changeset variable
    let changeset;
    
    if (noChangesetFound) {
      // Create a minimal changeset object with required fields
      changeset = {
        StackName: stackName,
        Status: 'NONE',
        ExecutionStatus: 'UNAVAILABLE',
        ChangeSetName: 'NO_CHANGESETS',
        Changes: []
      };
    } else {
      // Get changeset details
      const params = {
        ChangeSetName: actualChangesetName,
        StackName: stackName
      };
      
      changeset = await cloudformation.describeChangeSet(params);
    }
    
    // Generate report based on output format
    let report;
    
    if (noChangesetFound) {
      report = `\x1b[97m\x1b[1m── Cloudformation Changeset Report ──\x1b[0m\n\n`;
      report += `\x1b[93mNo changesets found for stack ${stackName}.\x1b[0m\n`;
      report += `\x1b[93mEnsure the stack exists and has at least one changeset created.\x1b[0m\n`;
    } else {
      report = generateActionReport(changeset);
    }

    
    
    // Set outputs first
    core.setOutput('report', report);
    core.setOutput('changeset-name', noChangesetFound ? 'NO_CHANGESETS' : actualChangesetName);
    core.setOutput('changeset-status', changeset.Status);
    
    // Always log the report for visibility in GitHub Actions logs
    logReport(report);
    
    if (noChangesetFound) {
      core.info(`No changesets found for stack ${stackName}. Continuing execution.`);
    }
    
    // Check if we should comment on PRs
    const commentOnPR = core.getInput('comment-on-pr').toLowerCase() !== 'false';
    
    // If this is a PR and commenting is enabled, try to comment as well
    if ((context.eventName === 'pull_request' || context.eventName === 'pull_request_target') && commentOnPR) {
      try {
        core.info('PR detected, attempting to add changeset report as a comment...');
        
        // Create a markdown version without ANSI color codes
        let markdownReport;
        
        if (noChangesetFound) {
          markdownReport = `# CloudFormation Changeset Report\n\n`;
          markdownReport += `> **Stack:** \`${stackName}\`  \n`;
          markdownReport += `> **Status:** \`NO_CHANGESETS\`  \n\n`;
          markdownReport += `## No Changesets Found\n\n`;
          markdownReport += `No changesets were found for this stack. This could mean:\n\n`;
          markdownReport += `- The stack doesn't have any pending changes\n`;
          markdownReport += `- The stack might not exist\n`;
          markdownReport += `- All changesets have been executed or deleted\n\n`;
          markdownReport += `Try creating a new changeset for this stack if you need to make changes.`;
        } else {
          markdownReport = generatePRReport(changeset);
        }
        
        // Get the token and check permissions
        const token = core.getInput('github-token');
        if (!token) {
          throw new Error("GitHub token not found. Make sure to provide the 'github-token' input.");
        }
        
        // Create authenticated client
        const octokit = github.getOctokit(token);
        
        // First check if we have permission to comment by getting PR details
        try {
          await octokit.rest.pulls.get({
            ...context.repo,
            pull_number: context.payload.pull_request.number
          });
        } catch (permError) {
          throw new Error(`Insufficient permissions to access PR data: ${permError.message}. Make sure your workflow has 'pull-requests: write' permission.`);
        }

        // Check for existing comments
        const existingComments = await octokit.rest.issues.listComments({
          ...context.repo,
          issue_number: context.payload.pull_request.number,
        });
        

        core.info(`Found ${existingComments.data.length} total comments on this PR`);
        
        // Add a hidden marker to help identify our comments
        const commentMarker = `<!-- CloudFormation ChangeSets for stack: ${stackName} -->`;
        const genericMarker = `<!-- CloudFormation ChangeSets Report -->`;
        const reportWithMarker = `${commentMarker}\n${markdownReport}`;
        
        // First, check if we have an existing comment for this specific stack
        const existingStackComment = existingComments.data.find(
          comment => comment.body && comment.body.includes(commentMarker)
        );
        
        // Next, check if we have any CloudFormation changeset comment for any stack
        const anyCfnComment = existingComments.data.find(
          comment => comment.body && (
            comment.body.includes(genericMarker) ||
            comment.body.includes('# CloudFormation Changeset Report')
          )
        );
        
        if (existingStackComment) {
          // Update the existing comment for this stack
          core.info(`Found existing comment (ID: ${existingStackComment.id}) for stack: ${stackName}`);
          await octokit.rest.issues.updateComment({
            ...context.repo,
            comment_id: existingStackComment.id,
            body: reportWithMarker
          });
          core.info(`Updated existing PR comment for stack: ${stackName}`);
        } else if (anyCfnComment) {
          // Append this stack's report to an existing CloudFormation changeset comment
          core.info(`Found existing CloudFormation comment (ID: ${anyCfnComment.id}). Appending stack: ${stackName}`);
          
          // Check if the comment already has our generic marker
          let updatedBody;
          if (!anyCfnComment.body.includes(genericMarker)) {
            // Add the generic marker if it doesn't exist
            updatedBody = `${genericMarker}\n${anyCfnComment.body}\n\n---\n\n${markdownReport}`;
          } else {
            // Otherwise just append the new report
            updatedBody = `${anyCfnComment.body}\n\n---\n\n${commentMarker}\n${markdownReport}`;
          }
          
          await octokit.rest.issues.updateComment({
            ...context.repo,
            comment_id: anyCfnComment.id,
            body: updatedBody
          });
          core.info(`Appended stack ${stackName} to existing CloudFormation PR comment`);
        } else {
          // Create a new comment with both markers
          const fullReport = `${genericMarker}\n${commentMarker}\n${markdownReport}`;
          await octokit.rest.issues.createComment({
            ...context.repo,
            issue_number: context.payload.pull_request.number,
            body: fullReport
          });
          core.info(`Created new PR comment for stack: ${stackName}`);
        }
        
        core.info("Successfully posted CloudFormation changeset report as PR comment");
      } catch (error) {
        core.warning(`Failed to comment on PR: ${error.message}`);
        core.warning('To fix this, ensure your workflow has the necessary permissions:');
        core.warning("1. Add 'permissions: write-all' or 'permissions: { pull-requests: write }' to your workflow");
        core.warning("2. If running on PR from a fork, use 'pull_request_target' event instead of 'pull_request'");
        core.warning("3. Ensure GITHUB_TOKEN is passed to the action with 'github-token: ${{ github.token }}'");
      }
    }
    
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}


function generateActionReport(changeset) {
  let report = `\x1b[97m\x1b[1m── Cloudformation Changeset Report ──\x1b[0m\n\n`;
  
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
      
      // Format each cell with proper width
      // The issue is with ANSI escape sequences taking up string length but not visual space
      // We'll use fixed ANSI sequence length for consistency
      
      const ANSI_COLOR_LENGTH = 9; // Standard ANSI color sequence length for our color codes
      
      const resourceCell = `${colorEmoji} ${textColorCode}${resource.LogicalResourceId}\x1b[0m`.padEnd(colWidths['Resource'] + ANSI_COLOR_LENGTH);
      const typeCell = resource.ResourceType.padEnd(colWidths['Type']);
      const actionCell = `${textColorCode}${resource.Action}\x1b[0m`.padEnd(colWidths['Action'] + ANSI_COLOR_LENGTH);
      const replacementCell = `${textColorCode}${resource.Replacement || 'N/A'}\x1b[0m`.padEnd(colWidths['Replacement'] + ANSI_COLOR_LENGTH);
      
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

/**
 * Creates a markdown formatted report without ANSI color codes
 */
function generatePRReport(changeset) {
  const changes = changeset.Changes || [];
  const totalCount = changes.length;
  
  // Group resources like in the original report
  const replacementGroups = {
    'Will be replaced': [],
    'Modified without replacement': [],
    'New resources': [],
    'Removed resources': []
  };
  
  // Categorize changes
  changes.forEach((change, i) => {
    const resource = change.ResourceChange;
    const needsReplacement = resource.Replacement === 'True' || resource.Replacement === 'Conditional';
    const isAdd = resource.Action === 'Add';
    const isRemove = resource.Action === 'Remove';
    
    if (isRemove) {
      replacementGroups['Removed resources'].push({ index: i+1, resource, change });
    } else if (needsReplacement) {
      replacementGroups['Will be replaced'].push({ index: i+1, resource, change });
    } else if (isAdd) {
      replacementGroups['New resources'].push({ index: i+1, resource, change });
    } else {
      replacementGroups['Modified without replacement'].push({ index: i+1, resource, change });
    }
  });
  
  // Build markdown report
  let markdown = `# CloudFormation Changeset Report\n\n`;

    // Add stack and changeset information
  markdown += `> **Stack:** \`${changeset.StackName}\`  \n`;
  markdown += `> **Changeset:** \`${changeset.ChangeSetName}\`  \n`;
  markdown += `> **Status:** \`${changeset.Status}\`  \n`;
  markdown += `> **Execution Status:** \`${changeset.ExecutionStatus || 'N/A'}\`\n\n`;
  
  // Add summary section
  markdown += `## Changes Summary (${totalCount})\n\n`;
  markdown += `- ⛔ **Resources to be removed:** ${replacementGroups['Removed resources'].length}\n`;
  markdown += `- 🔴 **Resources requiring replacement:** ${replacementGroups['Will be replaced'].length}\n`;
  markdown += `- 🟡 **Resources modified in-place:** ${replacementGroups['Modified without replacement'].length}\n`;
  markdown += `- 🟢 **New resources to be created:** ${replacementGroups['New resources'].length}\n\n`;
  
  // Add table of all changes
  if (totalCount > 0) {
    markdown += `## All Changes\n\n`;
    markdown += `| # | Resource | Type | Action | Replacement |\n`;
    markdown += `|---|---------|------|--------|-------------|\n`;
    
    changes.forEach((change, i) => {
      const resource = change.ResourceChange;
      const needsReplacement = resource.Replacement === 'True' || resource.Replacement === 'Conditional';
      const isAdd = resource.Action === 'Add';
      const isRemove = resource.Action === 'Remove';
      
      let emoji = '⚪';
      if (isRemove) emoji = '⛔';
      else if (needsReplacement) emoji = '🔴';
      else if (isAdd) emoji = '🟢';
      else emoji = '🟡';
      
      markdown += `| ${i+1} | ${emoji} ${resource.LogicalResourceId} | ${resource.ResourceType} | ${resource.Action} | ${resource.Replacement || 'N/A'} |\n`;
    });
    
    // Resources Requiring Replacement section
    if (replacementGroups['Will be replaced'].length > 0) {
      markdown += `\n## 🔴 Resources Requiring Replacement (${replacementGroups['Will be replaced'].length})\n\n`;
      
      replacementGroups['Will be replaced'].forEach(({ resource, change }, localIndex) => {
        markdown += `### ${localIndex + 1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        markdown += `- **Action:** ${resource.Action}\n`;
        markdown += `- **Replacement:** ${resource.Replacement}\n`;
        
        // Highlight what's causing the replacement
        markdown += `- **⚠️ Replacement Reason:**\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          const replacementCauses = resource.Details.filter(detail => 
            detail.Evaluation === 'Dynamic' || 
            detail.Target.RequiresRecreation === 'Always' ||
            detail.Target.RequiresRecreation === 'Conditionally'
          );
          
          if (replacementCauses.length > 0) {
            replacementCauses.forEach(detail => {
              markdown += `  - Property \`${detail.Target.Name}\` requires recreation (${detail.Target.RequiresRecreation})\n`;
            });
          } else {
            markdown += `  - Implicit replacement due to dependent resource changes\n`;
          }
          
          markdown += `\n- **All Property Changes:**\n`;
          resource.Details.forEach(detail => {
            const isReplacementCause = detail.Target.RequiresRecreation === 'Always' || 
                                      detail.Target.RequiresRecreation === 'Conditionally';
            const prefix = isReplacementCause ? '⚠️ ' : '';
            markdown += `  - ${prefix}${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        markdown += '\n';
      });
    }
    
    // Modified resources section
    if (replacementGroups['Modified without replacement'].length > 0) {
      markdown += `\n## 🟡 Resources Modified In-Place (${replacementGroups['Modified without replacement'].length})\n\n`;
      
      replacementGroups['Modified without replacement'].forEach(({ resource, change }, localIndex) => {
        markdown += `### ${localIndex + 1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        markdown += `- **Action:** ${resource.Action}\n`;
        markdown += `- **Replacement:** ${resource.Replacement || 'N/A'}\n`;
        
        if (resource.Details && resource.Details.length > 0) {
          markdown += `- **Property Changes:**\n`;
          resource.Details.forEach(detail => {
            markdown += `  - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        markdown += '\n';
      });
    }
    
    // New resources section
    if (replacementGroups['New resources'].length > 0) {
      markdown += `\n## 🟢 New Resources (${replacementGroups['New resources'].length})\n\n`;
      
      replacementGroups['New resources'].forEach(({ resource, change }, localIndex) => {
        markdown += `### ${localIndex + 1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        markdown += `- **Action:** ${resource.Action}\n`;
        
        // For new resources, we might not have details but can include them if available
        if (resource.Details && resource.Details.length > 0) {
          markdown += `- **Property Details:**\n`;
          resource.Details.forEach(detail => {
            markdown += `  - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        markdown += '\n';
      });
    }
    
    // Removed resources section
    if (replacementGroups['Removed resources'].length > 0) {
      markdown += `\n## ⛔ Resources Being Removed (${replacementGroups['Removed resources'].length})\n\n`;
      
      replacementGroups['Removed resources'].forEach(({ resource, change }, localIndex) => {
        markdown += `### ${localIndex + 1}. ${resource.LogicalResourceId} (${resource.ResourceType})\n`;
        markdown += `- **Action:** ${resource.Action}\n`;
        
        // For removed resources, show any available details
        if (resource.Details && resource.Details.length > 0) {
          markdown += `- **Resource Details:**\n`;
          resource.Details.forEach(detail => {
            markdown += `  - ${detail.Target.Name}: ${detail.ChangeSource} (${detail.Target.Attribute})\n`;
          });
        }
        
        markdown += `- **⚠️ Warning:** This resource will be **PERMANENTLY DELETED**\n\n`;
      });
    }
  } else {
    markdown += 'No changes detected.\n';
  }
  
  return markdown;
}

/**
 * Helper function to log the report to console line by line
 */
function logReport(report) {
  const reportLines = report.split('\n');
  reportLines.forEach(line => {
    core.info(line);
  });
}

// Export for testing
module.exports = { run };

// Run if this is the main module
if (require.main === module) {
  run();
}
