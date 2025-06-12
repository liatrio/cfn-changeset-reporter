const core = require('@actions/core');

// Mock the @actions/core module
jest.mock('@actions/core');

// Mock the AWS SDK
jest.mock('aws-sdk', () => {
  const mockDescribeChangeSet = jest.fn().mockReturnValue({
    promise: jest.fn().mockResolvedValue({
      StackName: 'test-stack',
      ChangeSetName: 'test-changeset',
      Status: 'CREATE_COMPLETE',
      CreationTime: '2023-01-01T00:00:00.000Z',
      Changes: [
        {
          ResourceChange: {
            LogicalResourceId: 'MyResource',
            ResourceType: 'AWS::S3::Bucket',
            Action: 'Add',
            Replacement: 'False'
          }
        }
      ]
    })
  });

  const mockListChangeSets = jest.fn().mockReturnValue({
    promise: jest.fn().mockResolvedValue({
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
    })
  });

  return {
    config: {
      update: jest.fn()
    },
    CloudFormation: jest.fn(() => ({
      describeChangeSet: mockDescribeChangeSet,
      listChangeSets: mockListChangeSets
    }))
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
        case 'output-format':
          return 'markdown';
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
