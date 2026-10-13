#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Request
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Get authentication information from environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables are required');
}

// Request kinds accepted by forms.batchUpdate (Forms API v1)
const BATCH_REQUEST_TYPES = [
  'updateFormInfo',
  'updateSettings',
  'createItem',
  'updateItem',
  'moveItem',
  'deleteItem',
];

class GoogleFormsServer {
  private server: Server;
  private oauth2Client: OAuth2Client;
  private forms: any;

  constructor() {
    this.server = new Server(
      {
        name: 'google-forms-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET
    );
    this.oauth2Client.setCredentials({
      refresh_token: REFRESH_TOKEN
    });

    // Initialize Google Forms API
    this.forms = google.forms({
      version: 'v1',
      auth: this.oauth2Client
    });

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_form',
          description: 'Create a new Google Form',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Form title',
              },
              description: {
                type: 'string',
                description: 'Form description (optional)',
              }
            },
            required: ['title'],
          },
        },
        {
          name: 'add_text_question',
          description: 'Add a text question to the form',
          inputSchema: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Form ID',
              },
              questionTitle: {
                type: 'string',
                description: 'Question title',
              },
              required: {
                type: 'boolean',
                description: 'Whether required (optional, default is false)',
              }
            },
            required: ['formId', 'questionTitle'],
          },
        },
        {
          name: 'add_multiple_choice_question',
          description: 'Add a multiple choice question to the form',
          inputSchema: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Form ID',
              },
              questionTitle: {
                type: 'string',
                description: 'Question title',
              },
              options: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of choices',
              },
              required: {
                type: 'boolean',
                description: 'Whether required (optional, default is false)',
              }
            },
            required: ['formId', 'questionTitle', 'options'],
          },
        },
        {
          name: 'get_form',
          description: 'Get form details',
          inputSchema: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Form ID',
              }
            },
            required: ['formId'],
          },
        },
        {
          name: 'get_form_responses',
          description: 'Get form responses',
          inputSchema: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Form ID',
              }
            },
            required: ['formId'],
          },
        },
        {
          name: 'batch_update',
          description: [
            'Apply a list of Google Forms API batchUpdate requests to an existing form.',
            'The whole batch is atomic: if any request fails, nothing is changed.',
            `Each request must contain exactly one of: ${BATCH_REQUEST_TYPES.join(', ')}.`,
            'Requests use the Forms API v1 shapes, e.g.',
            '{"updateFormInfo": {"info": {"title": "...", "description": "..."}, "updateMask": "title,description"}}',
            '{"updateItem": {"item": {"itemId": "...", "title": "...", "description": "..."}, "location": {"index": 0}, "updateMask": "title,description"}}.',
            'To edit existing items (e.g. to translate a copied form): call get_form first, then for each item send updateItem',
            'with its itemId, its current index as location.index, and an updateMask listing only the fields you change.',
            'updateMask paths are relative to the item, e.g. "questionItem.question.choiceQuestion.options".',
            'The item must always carry its kind, even when only the title changes, or the API rejects it as a type change:',
            'include "pageBreakItem": {} for sections and e.g. "questionItem": {"question": {"textQuestion": {}}} for text questions.',
            'For scale and choice questions send the whole sub-object ("questionItem.question.scaleQuestion" with low, high, lowLabel, highLabel;',
            '"questionItem.question.choiceQuestion" with type and options). Fields not in updateMask (such as required) stay unchanged.',
            'When replacing choice options, send every option with all its original fields (isOther, goToAction, goToSectionId, image) and change only "value", otherwise branching logic is lost.',
            'Pass the revisionId from get_form as requiredRevisionId to avoid overwriting concurrent edits.',
          ].join(' '),
          inputSchema: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Form ID',
              },
              requests: {
                type: 'array',
                items: {
                  type: 'object',
                },
                description: 'Array of Forms API batchUpdate Request objects, applied in order',
              },
              requiredRevisionId: {
                type: 'string',
                description: 'Optional. Fail if the form revision differs from this one (take it from get_form revisionId)',
              },
              includeFormInResponse: {
                type: 'boolean',
                description: 'Optional. Return the updated form in the response (default false)',
              }
            },
            required: ['formId', 'requests'],
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      try {
        switch (request.params.name) {
          case 'create_form':
            return await this.createForm(request.params.arguments);
          case 'add_text_question':
            return await this.addTextQuestion(request.params.arguments);
          case 'add_multiple_choice_question':
            return await this.addMultipleChoiceQuestion(request.params.arguments);
          case 'get_form':
            return await this.getForm(request.params.arguments);
          case 'get_form_responses':
            return await this.getFormResponses(request.params.arguments);
          case 'batch_update':
            return await this.batchUpdate(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        console.error('Error in tool execution:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async createForm(args: any) {
    if (!args.title) {
      throw new McpError(ErrorCode.InvalidParams, 'Title is required');
    }

    const form: any = {
      info: {
        title: args.title,
        documentTitle: args.title,
      }
    };

    if (args.description) {
      form.info.description = args.description;
    }

    try {
      const response = await this.forms.forms.create({
        requestBody: form,
      });

      const formId = response.data.formId;
      const responderUri = `https://docs.google.com/forms/d/${formId}/viewform`;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              formId,
              title: args.title,
              description: args.description || '',
              responderUri,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error creating form:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create form: ${error.message}`
      );
    }
  }

  private async addTextQuestion(args: any) {
    if (!args.formId || !args.questionTitle) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Form ID and question title are required'
      );
    }

    try {
      // Get the current form
      const form = await this.forms.forms.get({
        formId: args.formId,
      });

      // Create a request to add a new question
      const updateRequest = {
        requests: [
          {
            createItem: {
              item: {
                title: args.questionTitle,
                questionItem: {
                  question: {
                    required: args.required || false,
                    textQuestion: {}
                  }
                }
              },
              location: {
                index: 0
              }
            }
          }
        ]
      };

      // Update the form
      const response = await this.forms.forms.batchUpdate({
        formId: args.formId,
        requestBody: updateRequest,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Text question added successfully',
              questionTitle: args.questionTitle,
              required: args.required || false,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error adding text question:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add text question: ${error.message}`
      );
    }
  }

  private async addMultipleChoiceQuestion(args: any) {
    if (!args.formId || !args.questionTitle || !args.options || !Array.isArray(args.options)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Form ID, question title, and options array are required'
      );
    }

    try {
      // Create choices
      const choices = args.options.map((option: string) => ({
        value: option
      }));

      // Create a request to add a new question
      const updateRequest = {
        requests: [
          {
            createItem: {
              item: {
                title: args.questionTitle,
                questionItem: {
                  question: {
                    required: args.required || false,
                    choiceQuestion: {
                      type: 'RADIO',
                      options: choices,
                    }
                  }
                }
              },
              location: {
                index: 0
              }
            }
          }
        ]
      };

      // Update the form
      const response = await this.forms.forms.batchUpdate({
        formId: args.formId,
        requestBody: updateRequest,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Multiple choice question added successfully',
              questionTitle: args.questionTitle,
              options: args.options,
              required: args.required || false,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error adding multiple choice question:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to add multiple choice question: ${error.message}`
      );
    }
  }

  private async getForm(args: any) {
    if (!args.formId) {
      throw new McpError(ErrorCode.InvalidParams, 'Form ID is required');
    }

    try {
      const response = await this.forms.forms.get({
        formId: args.formId,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error getting form:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get form: ${error.message}`
      );
    }
  }

  private async getFormResponses(args: any) {
    if (!args.formId) {
      throw new McpError(ErrorCode.InvalidParams, 'Form ID is required');
    }

    try {
      const response = await this.forms.forms.responses.list({
        formId: args.formId,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error getting form responses:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get form responses: ${error.message}`
      );
    }
  }

  private async batchUpdate(args: any) {
    if (!args.formId) {
      throw new McpError(ErrorCode.InvalidParams, 'Form ID is required');
    }
    if (!Array.isArray(args.requests) || args.requests.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'requests must be a non-empty array');
    }

    args.requests.forEach((req: any, i: number) => {
      if (!req || typeof req !== 'object' || Array.isArray(req)) {
        throw new McpError(ErrorCode.InvalidParams, `requests[${i}] must be an object`);
      }
      const keys = Object.keys(req);
      if (keys.length !== 1 || !BATCH_REQUEST_TYPES.includes(keys[0])) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `requests[${i}] must contain exactly one of: ${BATCH_REQUEST_TYPES.join(', ')} (got: ${keys.join(', ') || 'nothing'})`
        );
      }
    });

    const requestBody: any = {
      requests: args.requests,
      includeFormInResponse: args.includeFormInResponse || false,
    };
    if (args.requiredRevisionId) {
      requestBody.writeControl = { requiredRevisionId: args.requiredRevisionId };
    }

    try {
      const response = await this.forms.forms.batchUpdate({
        formId: args.formId,
        requestBody,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              appliedRequests: args.requests.length,
              ...response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error in batch update:', error);
      // Surface Google's own error message (it names the failing request and field)
      const detail = error?.response?.data?.error?.message || error.message;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to batch update form: ${detail}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Google Forms MCP server running on stdio');
  }
}

const server = new GoogleFormsServer();
server.run().catch(console.error);
