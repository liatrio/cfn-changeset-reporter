# cfn-changeset-reporter

A GitHub Action to generate color-coded reports directly in GitHub Actions logs from AWS CloudFormation changesets with focus on resource replacement impact.

## Features

- Generates detailed reports about CloudFormation changesets
- Color-codes resources by their impact (🟢 Add, 🟡 Modify, 🔴 Replacement)
- Groups resources by replacement status for better visibility
- Highlights which property changes cause resource replacements
- Outputs directly to GitHub Actions console with rich formatting
- Can use the latest changeset or a specified one
- Provides outputs that can be used by subsequent workflow steps
- Dynamic table formatting that automatically adjusts column widths based on content

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

- 🔴 **Resources requiring replacement** - Highest impact changes that will create new resources
- 🟡 **Resources modified in-place** - Medium impact changes that modify existing resources
- 🟢 **New resources** - Resources being added for the first time

### Replacement Detail Analysis

For resources that require replacement:

- Identifies and highlights the specific property changes causing the replacement
- Marks properties with `⚠️` when they trigger resource recreation
- Shows whether replacement is conditional or always required

## Development

### Prerequisites

- Node.js 16+

### Setup

```bash
npm install
npm run build
```

The built action will be in the `dist` folder.
