# cfn-changeset-reporter

A GitHub Action to generate reports from AWS CloudFormation changesets.

## Features

- Generates detailed reports about CloudFormation changesets
- Supports multiple output formats (Markdown, JSON, Text)
- Can use the latest changeset or a specified one
- Provides outputs that can be used by subsequent workflow steps

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
        uses: ./
        with:
          aws-region: us-east-1
          stack-name: my-stack
          changeset-name: pr-${{ github.event.pull_request.number }}
          output-format: markdown
          output-file: changeset-report.md
          
      - name: Add report as PR comment
        uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('changeset-report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            })
```

## Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| `aws-region` | AWS region to connect to | Yes | `us-east-1` |
| `stack-name` | Name of the CloudFormation stack | Yes | - |
| `changeset-name` | Name of the changeset to report on | No | Latest changeset |
| `output-format` | Format of the output report (text, json, markdown) | No | `markdown` |
| `output-file` | Path to save the report output, if not specified outputs to console | No | - |

## Outputs

| Name | Description |
|------|-------------|
| `report` | The generated report content |
| `changeset-name` | Name of the changeset that was analyzed |
| `changeset-status` | Status of the changeset (CREATE_COMPLETE, CREATE_FAILED, etc.) |

## Development

### Prerequisites
- Node.js 16+

### Setup
```bash
npm install
npm run build
```

The built action will be in the `dist` folder.
