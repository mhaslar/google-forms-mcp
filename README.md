[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/matteoantoci-google-forms-mcp-badge.png)](https://mseep.ai/app/matteoantoci-google-forms-mcp)

# Google Forms MCP Server

This MCP server uses the Google Forms API to provide functions such as creating, editing, and retrieving responses for forms.

## Build Method

### Initial Setup
After cloning the repository, install dependencies
```
cd google-forms-mcp
npm install
```

### Build the Server
```
# Build the main MCP server
npm run build
```

### Build the Refresh Token Acquisition Script
```
# Build the refresh token acquisition script
npm run build:token
```

### Execution in Development Environment
```
# Run the server directly
node build/index.js

# Or, use npm script
npm run start
```


## Setup Method

1. Create a project in Google Cloud Console and enable the Google Forms API.
   - https://console.cloud.google.com/
   - Search for "Google Forms API" from APIs & Services > Library and enable it.

2. Obtain OAuth 2.0 Client ID and Secret.
   - APIs & Services > Credentials > Create Credentials > OAuth client ID
   - Select Application type: "Desktop app"

3. Set environment variables and obtain the refresh token.
   ```bash
   export GOOGLE_CLIENT_ID="YOUR_CLIENT_ID"
   export GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
   cd google-forms-mcp
   npm run build
   node build/get-refresh-token.js
   ```

   Note: If an error occurs when running get-refresh-token.js, execute the following command:
   ```bash
   cd google-forms-mcp
   npm run build:token
   node build/get-refresh-token.js
   ```

4. Copy the displayed refresh token.

5. Update the Claude desktop app's configuration file.
   - Open `~/Library/Application Support/Claude/claude_desktop_config.json`.
   - Add environment variables to the `google-forms-mcp` in the `mcpServers` section:
   ```json
   "google-forms-mcp": {
     "command": "node",
     "args": [
       "/path/to/your/google-forms-mcp/build/index.js" # Update this path
     ],
     "env": {
       "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID",
       "GOOGLE_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
       "GOOGLE_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN"
     }
   }
   ```

6. Restart the Claude desktop app.

## Available Tools

This MCP server provides the following tools:

1. `create_form` - Create a new Google Form
2. `add_text_question` - Add a text question to the form
3. `add_multiple_choice_question` - Add a multiple choice question to the form
4. `get_form` - Get form details
5. `get_form_responses` - Get form responses
6. `batch_update` - Apply raw Forms API `batchUpdate` requests (`updateFormInfo`, `updateSettings`, `createItem`, `updateItem`, `moveItem`, `deleteItem`) to an existing form. The batch is atomic and supports `requiredRevisionId` for safe concurrent edits.

### Translating an existing form

1. Copy the form (e.g. with the Google Drive connector's `copy_file`) once per language. The copy keeps all question types, sections, branching and settings.
2. Call `get_form` on the copy to get its items, their `itemId`s, positions and the `revisionId`.
3. Call `batch_update` with an `updateFormInfo` request for the title/description and one `updateItem` request per item, keeping `itemId` and the item's current index, with an `updateMask` that lists only the translated text fields:

```json
{
  "formId": "COPY_FORM_ID",
  "requiredRevisionId": "REVISION_ID_FROM_GET_FORM",
  "requests": [
    { "updateFormInfo": { "info": { "title": "Registration", "description": "..." }, "updateMask": "title,description" } },
    { "updateItem": {
        "item": { "itemId": "1a2b3c4d", "title": "Your name", "description": "As on your ID" },
        "location": { "index": 0 },
        "updateMask": "title,description"
    } }
  ]
}
```

When translating choice options, send the full `options` array with every original field (`isOther`, `goToAction`, `goToSectionId`, `image`) and change only `value`; otherwise branching is lost.

## Usage Example

```
Create a form and add some questions.
```

Claude uses MCP tools like the following to create the form:

1. Use the `create_form` tool to create a new form
2. Use `add_text_question` or `add_multiple_choice_question` tools to add questions
3. Display the URL of the created form
