# cfn-changeset-reporter

A GitHub Action to generate color-coded reports directly in GitHub Actions logs from AWS CloudFormation changesets with focus on resource replacement impact.

## Features

- Generates detailed reports about CloudFormation changesets
- Color-codes resources by their impact (🟢 Add, 🟡 Modify, 🔴 Replacement, ⛔ Removal)
- Groups resources by replacement status for better visibility
- Highlights which property changes cause resource replacements
- Outputs directly to GitHub Actions console with rich formatting
- Can use the latest changeset or a specified one
- Provides outputs that can be used by subsequent workflow steps
- Dynamic table formatting that automatically adjusts column widths based on content
- Enhanced visualization with ANSI color codes and emojis for better readability

## Usage

```yaml
name: Report CloudFormation Changes

on:
  pull_request:
    branches: [ main ]
  workflow_dispatch:

jobs:
  report-changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Create CloudFormation changeset
        run: |
          aws cloudformation create-change-set \
            --stack-name my-stack \
            --change-set-name pr-${{ github.event.pull_request.number }} \
            --template-body file://template.yaml \
            --capabilities CAPABILITY_IAM

      - name: Report on changeset
        id: changeset-report
        uses: ./
        with:
          aws-region: us-east-1
          stack-name: my-stack
          changeset-name: pr-${{ github.event.pull_request.number }}
          
      - name: Add report as PR comment using action output
        uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: ${{ steps.changeset-report.outputs.report }}
            })
```

## Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| `aws-region` | AWS region to connect to | Yes | `us-east-1` |
| `stack-name` | Name of the CloudFormation stack | Yes | - |
| `changeset-name` | Name of the changeset to report on | No | Latest changeset |
| `github-token` | GitHub token for commenting on PRs | No | `${{ github.token }}` |
| `comment-on-pr` | Whether to comment on PRs with the report | No | `true` |

## Outputs

| Name | Description |
|------|-------------|
| `report` | The generated report content |
| `changeset-name` | Name of the changeset that was analyzed |
| `changeset-status` | Status of the changeset (CREATE_COMPLETE, CREATE_FAILED, etc.) |

## Sample Report Features

The generated report includes:

### Resource Grouping and Color Coding

Resources are grouped and color-coded by their impact:

- ⛔ **Resources to be removed** - Resources that will be completely deleted from the stack
- 🔴 **Resources requiring replacement** - Highest impact changes that will create new resources
- 🟡 **Resources modified in-place** - Medium impact changes that modify existing resources
- 🟢 **New resources** - Resources being added for the first time

### Detailed Section Analysis

#### For Resources That Require Replacement

- Identifies and highlights the specific property changes causing the replacement
- Marks properties with `⚠️` when they trigger resource recreation
- Shows whether replacement is conditional or always required

#### For Resources Being Removed

- Provides clear warning about permanent deletion
- Displays the resource type and identifier with prominent formatting
- Lists any available property details about the resource being removed

#### For Modified and Added Resources

- Shows clean, categorized lists of all changes
- Uses color-coded property names to indicate change impact
- Formats complex resource types using subtle gray coloring for better readability

### Dynamic Table Formatting

- Automatically adjusts column widths based on content length
- Color-codes resource names and actions based on their impact
- Uses consistent spacing and formatting for better readability
- Provides emoji indicators (⛔,🔴,🟡,🟢) for quick visual assessment
- Highlights critical information with bright colors and bold text

## PR Commenting Feature

When this action runs in a pull request context, it can automatically add the changeset report as a comment on the PR.

The PR commenting feature is:

- **Enabled by default** - Works automatically on PR events
- **Optional** - Can be disabled with `comment-on-pr: false`
- **Consolidated** - Multiple stacks will be reported in a single comment

### Disabling PR Comments

If you want to disable PR comments, set `comment-on-pr` to `false`:

```yaml
- name: Report CloudFormation Changes
  uses: liatrio/cfn-changeset-reporter@v1
  with:
    aws-region: us-east-1
    stack-name: my-stack
    comment-on-pr: false
```

### Comment Update Behavior

When the action runs multiple times on the same PR for the same stack:

- It will update any existing comments for that stack instead of creating new ones
- This helps keep the PR thread clean and focused, especially for PRs with multiple stacks or frequent updates

### 1. Add Required Permissions to Your Workflow

```yaml
name: Report CloudFormation Changes

on:
  pull_request:
    branches: [ main ]

# Add permissions to allow PR comments
permissions:
  pull-requests: write
  contents: read

jobs:
  report-changes:
    runs-on: ubuntu-latest
    steps:
      # Your other steps...
      
      - name: Report CloudFormation Changes
        uses: liatrio/cfn-changeset-reporter@v1
        with:
          aws-region: us-east-1
          stack-name: my-stack
          github-token: ${{ github.token }} # This enables PR commenting
```

### 2. For PRs from Forks

If you need to support PRs from forks, use `pull_request_target` instead of `pull_request` with caution:

```yaml
on:
  pull_request_target:
    branches: [ main ]
```

**⚠️ Security Note:** When using `pull_request_target`, be careful as it runs workflows with repository token permissions using the code from the PR.

## Development

### Prerequisites

- Node.js 16+

### Setup

```bash
npm install
npm run build
```

The built action will be in the `dist` folder.
