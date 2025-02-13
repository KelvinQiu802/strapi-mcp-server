#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import qs from 'qs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import sharp from 'sharp';
import { CONNECT_TO_STRAPI_CONTENT } from './promts/connect.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from "zod";

// Read config file
const CONFIG_PATH = join(homedir(), '.mcp', 'strapi-mcp-server.config.json');
let config: Record<string, { api_url: string, api_key: string }>;

try {
    const configContent = readFileSync(CONFIG_PATH, 'utf-8');
    config = JSON.parse(configContent);

    if (Object.keys(config).length === 0) {
        throw new Error('Config file exists but is empty');
    }
} catch (error) {
    console.error('Error reading config file:', error);
    config = {};
}

// Create server instance
const server = new McpServer({
    name: "strapi-mcp",
    version: "1.0.0"
});

// Helper function to get server config
function getServerConfig(serverName: string): { API_URL: string, JWT: string } {
    if (Object.keys(config).length === 0) {
        const exampleConfig = {
            "myserver": {
                "api_url": "http://localhost:1337",
                "api_key": "your-jwt-token-from-strapi-admin"
            }
        };

        throw new Error(
            `No server configuration found!\n\n` +
            `Please create a configuration file at:\n` +
            `${CONFIG_PATH}\n\n` +
            `Example configuration:\n` +
            `${JSON.stringify(exampleConfig, null, 2)}\n\n` +
            `Steps to set up:\n` +
            `1. Create the .mcp directory: mkdir -p ~/.mcp\n` +
            `2. Create the config file: touch ~/.mcp/strapi-mcp-server.config.json\n` +
            `3. Add your server configuration using the example above\n` +
            `4. Get your JWT token from Strapi Admin Panel > Settings > API Tokens\n` +
            `5. Make sure the file permissions are secure: chmod 600 ~/.mcp/strapi-mcp-server.config.json`
        );
    }

    const serverConfig = config[serverName];
    if (!serverConfig) {
        throw new Error(
            `Server "${serverName}" not found in config.\n\n` +
            `Available servers: ${Object.keys(config).join(', ')}\n\n` +
            `To add a new server, edit:\n` +
            `${CONFIG_PATH}\n\n` +
            `Example configuration:\n` +
            `{\n` +
            `  "${serverName}": {\n` +
            `    "api_url": "http://localhost:1337",\n` +
            `    "api_key": "your-jwt-token-from-strapi-admin"\n` +
            `  }\n` +
            `}`
        );
    }
    return {
        API_URL: serverConfig.api_url,
        JWT: serverConfig.api_key
    };
}

// Helper function for making Strapi API requests
async function makeStrapiRequest(serverName: string, endpoint: string, params?: Record<string, string>): Promise<any> {
    const serverConfig = getServerConfig(serverName);
    let url = `${serverConfig.API_URL}${endpoint}`;
    if (params) {
        const queryString = new URLSearchParams(params).toString();
        url = `${url}?${queryString}`;
    }

    const headers = {
        'Authorization': `Bearer ${serverConfig.JWT}`,
        'Content-Type': 'application/json',
    };

    try {
        const response = await fetch(url, { headers });
        return await handleStrapiError(response, `Request to ${endpoint}`);
    } catch (error) {
        console.error("Error making Strapi request:", error);
        throw error;
    }
}

// List available prompts
server.prompt(
    "Connect to Strapi",
    "Start a conversation with an expert who understands both Strapi v4 and v5",
    async () => {
        return {
            messages: [
                {
                    role: "assistant",
                    content: {
                        type: "text",
                        text: CONNECT_TO_STRAPI_CONTENT
                    }
                }
            ]
        };
    }
);

// Define tools using server.tool()
server.tool(
    "strapi_list_servers",
    "Lists all available Strapi servers and their configurations, including server names and API URLs. If no servers are configured, provides a detailed setup guide with step-by-step instructions for configuration. Helps manage multiple Strapi instances through a centralized configuration.",
    {},
    async () => {
        if (Object.keys(config).length === 0) {
            const exampleConfig = {
                "myserver": {
                    "api_url": "http://localhost:1337",
                    "api_key": "your-jwt-token-from-strapi-admin"
                }
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: "No servers configured",
                        help: {
                            message: "No server configuration found. Please create a configuration file.",
                            config_path: CONFIG_PATH,
                            example_config: exampleConfig,
                            setup_steps: [
                                "Create the .mcp directory: mkdir -p ~/.mcp",
                                "Create the config file: touch ~/.mcp/strapi-mcp-server.config.json",
                                "Add your server configuration using the example above",
                                "Get your JWT token from Strapi Admin Panel > Settings > API Tokens",
                                "Make sure the file permissions are secure: chmod 600 ~/.mcp/strapi-mcp-server.config.json"
                            ]
                        }
                    }, null, 2)
                }]
            };
        }

        const servers = Object.keys(config).map(serverName => ({
            name: serverName,
            api_url: config[serverName].api_url
        }));

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    servers,
                    config_path: CONFIG_PATH,
                    help: "To add more servers, edit the configuration file at the path shown above."
                }, null, 2)
            }]
        };
    }
);

server.tool(
    "strapi_get_content_types",
    "Retrieves all content type definitions from Strapi. Returns complete content type schemas including field definitions, relationships, and validation rules. Provides comprehensive guides for both REST API and GraphQL usage, with examples of CRUD operations and best practices for data querying.",
    {
        server: z.string().describe("The name of the server to connect to")
    },
    async (args, extra) => {
        const server = args.server as string;
        const data = await makeStrapiRequest(server, "/api/content-type-builder/content-types");

        const response = {
            data: data,
            usage_guide: {
                naming_conventions: {
                    rest_api: "Use pluralName for REST API endpoints (e.g., 'api/articles' for pluralName: 'articles')",
                    graphql: {
                        collections: "Use pluralName for collections (e.g., 'query { articles { data { id } } }')",
                        single_items: "Use singularName for single items (e.g., 'query { article(id: 1) { data { id } } }')"
                    }
                },
                examples: {
                    rest: {
                        collection: "GET /api/{pluralName}",
                        single: "GET /api/{pluralName}/{id}",
                        create: "POST /api/{pluralName}",
                        update: "PUT /api/{pluralName}/{id}",
                        delete: "DELETE /api/{pluralName}/{id}"
                    },
                    graphql: {
                        collection: "query { pluralName(pagination: { page: 1, pageSize: 100 }) { data { id attributes } } }",
                        single: "query { singularName(id: 1) { data { id attributes } } }",
                        create: "mutation { createPluralName(data: { field: value }) { data { id } } }",
                        update: "mutation { updatePluralName(id: 1, data: { field: value }) { data { id } } }"
                    }
                },
                important_notes: [
                    "Always check singularName and pluralName in the schema for correct endpoint/query names",
                    "REST endpoints always start with 'api/'",
                    "Include pagination in GraphQL collection queries",
                    "For updates, always fetch current data first and include ALL fields in the update"
                ]
            }
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(response, null, 2)
            }]
        };
    }
);

server.tool(
    "strapi_get_components",
    "Fetches all component definitions from Strapi with pagination support. Components are reusable field collections that can be shared across content types. Returns component data along with pagination metadata (page number, items per page, total count, total pages). Essential for understanding the building blocks of your Strapi content structure.",
    {
        server: z.string().describe("The name of the server to connect to"),
        page: z.number().min(1).default(1).describe("Page number (starts at 1)"),
        pageSize: z.number().min(1).default(25).describe("Number of items per page")
    },
    async (args, extra) => {
        const server = args.server as string;
        const page = args.page as number;
        const pageSize = args.pageSize as number;

        const params = {
            'pagination[page]': page.toString(),
            'pagination[pageSize]': pageSize.toString(),
        };

        const data = await makeStrapiRequest(server, "/api/content-type-builder/components", params);

        const response = {
            data: data,
            pagination: {
                page,
                pageSize,
                total: data.length,
                pageCount: Math.ceil(data.length / pageSize),
            },
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(response, null, 2)
            }]
        };
    }
);

server.tool(
    "strapi_rest",
    "Executes Strapi REST API requests with automatic schema validation. Features: 1) Automatic data validation for write operations, 2) Field type checking, 3) Required field validation, 4) Detailed field-specific error messages. Collection endpoints automatically include pagination (page=1&pageSize=100) and relation population (populate=*). Supports full CRUD operations with built-in data integrity checks.",
    {
        server: z.string().describe("The name of the server to connect to"),
        endpoint: z.string().describe("The API endpoint (e.g., 'api/articles'). Check strapi_get_content_types first to see available endpoints."),
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET").describe("HTTP method to use. For write operations (POST/PUT), data is automatically validated against the content type schema."),
        params: z.record(z.any()).optional().describe("Query parameters (filters, sort, etc.). Use schema from strapi_get_content_types to determine valid fields."),
        body: z.record(z.any()).optional().describe("Request body for POST/PUT requests. Must match the schema from strapi_get_content_types. Data is automatically validated before sending.")
    },
    async (args, extra) => {
        const server = args.server as string;
        const endpoint = args.endpoint as string;
        const method = args.method as string;
        const params = args.params as Record<string, any> | undefined;
        const body = args.body as Record<string, any> | undefined;

        const data = await makeRestRequest(server, endpoint, method, params, body);
        return {
            content: [{
                type: "text",
                text: JSON.stringify(data, null, 2)
            }]
        };
    }
);

server.tool(
    "strapi_upload_media",
    "Uploads media files to Strapi's media library with advanced processing capabilities. Features: 1) URL-based upload support, 2) Format conversion (JPEG/PNG/WebP), 3) Quality control with compression options, 4) Comprehensive metadata management. Returns detailed file information including ID, URL, and integration guides for both REST and GraphQL. Ideal for handling images in content management workflows.",
    {
        server: z.string().describe("The name of the server to connect to"),
        url: z.string().url().describe("URL of the image to upload"),
        format: z.enum(["jpeg", "png", "webp", "original"]).default("original").describe("Target format for the image. Use 'original' to keep the source format."),
        quality: z.number().min(1).max(100).default(80).describe("Image quality (1-100). Only applies when converting formats."),
        metadata: z.object({
            name: z.string().optional().describe("Name of the file"),
            caption: z.string().optional().describe("Caption for the image"),
            alternativeText: z.string().optional().describe("Alternative text for accessibility"),
            description: z.string().optional().describe("Detailed description of the image")
        }).optional()
    },
    async (args, extra) => {
        const server = args.server as string;
        const url = args.url as string;
        const format = args.format as string;
        const quality = args.quality as number;
        const metadata = args.metadata as {
            name?: string;
            caption?: string;
            alternativeText?: string;
            description?: string;
        } | undefined;

        const fileName = url.split('/').pop() || 'image';
        const imageBuffer = await downloadImage(url);
        const processedBuffer = await processImage(imageBuffer, format, quality);
        const data = await uploadMedia(server, processedBuffer, fileName, format, metadata);

        const response = {
            success: true,
            data: data,
            image_info: {
                format: format === 'original' ? 'original (unchanged)' : format,
                quality: format === 'original' ? 'original (unchanged)' : quality,
                filename: data[0].name,
                size: data[0].size,
                mime: data[0].mime
            },
            usage_guide: {
                file_id: data[0].id,
                url: data[0].url,
                how_to_use: {
                    rest_api: "Use the file ID in your content type's media field",
                    graphql: "Use the file ID in your GraphQL mutations",
                    examples: {
                        rest: `PUT /api/content-type/1 with body: { data: { image: ${data[0].id} } }`,
                        graphql: `mutation { updateContentType(id: 1, data: { image: ${data[0].id} }) { data { id } } }`
                    }
                }
            }
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(response, null, 2)
            }]
        };
    }
);

// Cache for content type schemas
let contentTypeSchemas: Record<string, any> = {};

// Schema validation helper
async function validateAgainstSchema(serverName: string, endpoint: string, data: any): Promise<{ isValid: boolean; errors: string[] }> {
    // Extract content type from endpoint (e.g., "api/articles" -> "articles")
    const contentType = endpoint.replace(/^api\//, '').split('/')[0];

    // Get or fetch schema
    if (!contentTypeSchemas[contentType]) {
        try {
            const schema = await makeStrapiRequest(serverName, "/api/content-type-builder/content-types");
            const typeSchema = schema.data.find((type: any) => type.schema.pluralName === contentType);
            if (typeSchema) {
                contentTypeSchemas[contentType] = typeSchema.schema;
            }
        } catch (error) {
            console.error(`Failed to fetch schema for ${contentType}:`, error);
            return { isValid: true, errors: [] }; // Fail open if we can't fetch schema
        }
    }

    const schema = contentTypeSchemas[contentType];
    if (!schema) {
        return { isValid: true, errors: [] }; // Fail open if no schema found
    }

    const errors: string[] = [];

    // Validate required fields
    schema.attributes.forEach((attr: any) => {
        if (attr.required && !data[attr.name]) {
            errors.push(`Missing required field: ${attr.name}`);
        }

        if (data[attr.name]) {
            // Type validation
            switch (attr.type) {
                case 'string':
                    if (typeof data[attr.name] !== 'string') {
                        errors.push(`Field ${attr.name} must be a string`);
                    }
                    break;
                case 'integer':
                case 'biginteger':
                    if (!Number.isInteger(data[attr.name])) {
                        errors.push(`Field ${attr.name} must be an integer`);
                    }
                    break;
                case 'float':
                case 'decimal':
                    if (typeof data[attr.name] !== 'number') {
                        errors.push(`Field ${attr.name} must be a number`);
                    }
                    break;
                case 'boolean':
                    if (typeof data[attr.name] !== 'boolean') {
                        errors.push(`Field ${attr.name} must be a boolean`);
                    }
                    break;
                case 'date':
                case 'datetime':
                    if (isNaN(Date.parse(data[attr.name]))) {
                        errors.push(`Field ${attr.name} must be a valid date`);
                    }
                    break;
                // Add more type validations as needed
            }
        }
    });

    return {
        isValid: errors.length === 0,
        errors
    };
}

// Enhanced REST request function with validation
async function makeRestRequest(
    serverName: string,
    endpoint: string,
    method: string = 'GET',
    params?: Record<string, any>,
    body?: Record<string, any>
): Promise<any> {
    const serverConfig = getServerConfig(serverName);
    let url = `${serverConfig.API_URL}/${endpoint}`;

    // Validate data against schema for write operations
    if (body?.data && (method === 'POST' || method === 'PUT')) {
        const validation = await validateAgainstSchema(serverName, endpoint, body.data);
        if (!validation.isValid) {
            throw new Error(`Validation failed:\n${validation.errors.join('\n')}`);
        }
    }

    // 使用 qs 构建查询参数
    if (params) {
        const queryString = qs.stringify(params, {
            encodeValuesOnly: true // 只编码值而不编码键
        });
        if (queryString) {
            url = `${url}?${queryString}`;
        }
    }

    const headers = {
        'Authorization': `Bearer ${serverConfig.JWT}`,
        'Content-Type': 'application/json',
    };

    const requestOptions: import('node-fetch').RequestInit = {
        method,
        headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
        requestOptions.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, requestOptions);
        return await handleStrapiError(response, `REST request to ${endpoint}`);
    } catch (error) {
        console.error(`REST request to ${endpoint} failed:`, error);
        throw error;
    }
}

// Update handleStrapiError with enhanced error messages
async function handleStrapiError(response: import('node-fetch').Response, context: string): Promise<any> {
    if (!response.ok) {
        let errorMessage = `${context} failed with status: ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData.error) {
                errorMessage += ` - ${errorData.error.message || JSON.stringify(errorData.error)}`;

                // Enhanced error messages
                if (response.status === 400) {
                    errorMessage += "\nValidation Errors:\n";
                    if (errorData.error.details?.errors) {
                        errorMessage += errorData.error.details.errors
                            .map((err: any) => `- ${err.path.join('.')}: ${err.message}`)
                            .join('\n');
                    }
                    errorMessage += "\n\nHINT: Check the following:\n" +
                        "1. All required fields are provided\n" +
                        "2. Field types match the schema\n" +
                        "3. Related content exists\n" +
                        "4. Values are within allowed ranges";
                } else if (response.status === 404) {
                    errorMessage += "\nHINT: Check the following:\n" +
                        "1. The endpoint path is correct\n" +
                        "2. The content type exists\n" +
                        "3. The ID exists (for single item operations)\n" +
                        "4. You're using the correct plural/singular form";
                }
            }
        } catch {
            errorMessage += ` - ${response.statusText}`;
        }
        throw new Error(errorMessage);
    }
    return response.json();
}

// Helper function to download image as buffer
async function downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

// Helper function to process image with Sharp
async function processImage(buffer: Buffer, format: string, quality: number): Promise<Buffer> {
    let sharpInstance = sharp(buffer);

    if (format !== 'original') {
        switch (format) {
            case 'jpeg':
                sharpInstance = sharpInstance.jpeg({ quality });
                break;
            case 'png':
                // PNG quality is 0-100 for zlib compression level
                sharpInstance = sharpInstance.png({
                    compressionLevel: Math.floor((100 - quality) / 100 * 9)
                });
                break;
            case 'webp':
                sharpInstance = sharpInstance.webp({ quality });
                break;
        }
    }

    return sharpInstance.toBuffer();
}

// Update uploadMedia with server config
async function uploadMedia(serverName: string, imageBuffer: Buffer, fileName: string, format: string, metadata?: Record<string, any>): Promise<any> {
    const serverConfig = getServerConfig(serverName);
    const formData = new FormData();

    // Update filename extension if format is changed
    if (format !== 'original') {
        fileName = fileName.replace(/\.[^/.]+$/, '') + '.' + format;
    }

    // Add the file
    formData.append('files', imageBuffer, {
        filename: fileName,
        contentType: `image/${format === 'original' ? 'jpeg' : format}` // Default to jpeg for original
    });

    // Add metadata if provided
    if (metadata) {
        formData.append('fileInfo', JSON.stringify(metadata));
    }

    const url = `${serverConfig.API_URL}/api/upload`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serverConfig.JWT}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    return handleStrapiError(response, 'Media upload');
}

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Strapi MCP Server running on stdio");
}

main().catch((error: unknown) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
}); 