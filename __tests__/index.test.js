const core = require('@actions/core');

// Mock the @actions/core module
jest.mock('@actions/core');

// Mock AWS SDK v3
jest.mock('@aws-sdk/client-cloudformation', () => {
  // Create a mock changeset response with all types of resources
  const mockChangesetResponse = {
    StackName: 'test-stack',
    ChangeSetName: 'test-changeset',
    Status: 'CREATE_COMPLETE',
    CreationTime: '2023-01-01T00:00:00.000Z',
    Changes: [
      {
        ResourceChange: {
          LogicalResourceId: 'MyNewResource',
          ResourceType: 'AWS::S3::Bucket',
          Action: 'Add',
          Replacement: 'False',
          Details: [
            {
              Target: {
                Name: 'BucketName',
                Attribute: 'Properties',
                RequiresRecreation: 'Never'
              },
              ChangeSource: 'DirectModification',
              Evaluation: 'Static'
            }
          ]
        }
      },
      {
        ResourceChange: {
          LogicalResourceId: 'MyReplacementResource',
          ResourceType: 'AWS::Lambda::Function',
          Action: 'Modify',
          Replacement: 'True',
          Details: [
            {
              Target: {
                Name: 'Runtime',
                Attribute: 'Properties',
                RequiresRecreation: 'Always'
              },
              ChangeSource: 'DirectModification',
              Evaluation: 'Static'
            }
          ]
        }
      },
      {
        ResourceChange: {
          LogicalResourceId: 'MyModifiedResource',
          ResourceType: 'AWS::IAM::Role',
          Action: 'Modify',
          Replacement: 'False',
          Details: [
            {
              Target: {
                Name: 'PolicyName',
                Attribute: 'Properties',
                RequiresRecreation: 'Never'
              },
              ChangeSource: 'DirectModification',
              Evaluation: 'Static'
            }
          ]
        }
      },
      {
        ResourceChange: {
          LogicalResourceId: 'MyRemovedResource',
          ResourceType: 'AWS::DynamoDB::Table',
          Action: 'Remove'
        }
      }
    ]
  };

  // Create mock for listChangeSets
  const mockListChangeSetsResponse = {
    Summaries: [
      {
        ChangeSetName: 'latest-changeset',
        CreationTime: '2023-01-02T00:00:00.000Z'
      },
      {
        ChangeSetName: 'older-changeset',
        CreationTime: '2023-01-01T00:00:00.000Z'
      }
    ]
  };

  // Return the CloudFormation class constructor mock
  return {
    CloudFormation: jest.fn().mockImplementation(() => {
      return {
        describeChangeSet: jest.fn().mockResolvedValue(mockChangesetResponse),
        listChangeSets: jest.fn().mockResolvedValue(mockListChangeSetsResponse)
      };
    })
  };
});

describe('CloudFormation Changeset Reporter', () => {
  // Clear all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Run function without errors', async () => {
    // Set up core.getInput mock values
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'aws-region':
          return 'us-east-1';
        case 'stack-name':
          return 'test-stack';
        case 'changeset-name':
          return 'test-changeset';
        default:
          return '';
      }
    });

    // Import the action after mocks have been set up
    const action = require('../index.js');
    
    // Verify calls to core.setOutput
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('changeset-name', 'test-changeset');
    expect(core.setOutput).toHaveBeenCalledWith('changeset-status', 'CREATE_COMPLETE');
    expect(core.setOutput).toHaveBeenCalledWith('report', expect.any(String));
  });
});
