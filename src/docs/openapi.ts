// Minimal but complete OpenAPI 3 spec served at /api/docs via swagger-ui-express.
export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Contract Operations Console API",
    version: "1.0.0",
    description:
      "Multi-tenant contract management API. All /api/contracts routes require an `X-Org-Id` header.",
  },
  servers: [{ url: "/" }],
  components: {
    parameters: {
      OrgId: {
        name: "X-Org-Id",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
        description: "Organisation scope for the request.",
      },
    },
    schemas: {
      ContractItem: {
        type: "object",
        required: ["description", "quantity", "unit_price"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 },
          quantity_unit: { type: "string" },
          unit_price: { type: "number", minimum: 0 },
          pricing_unit: { type: "string" },
          total: { type: "number" },
        },
      },
      ContractPayload: {
        type: "object",
        required: ["client_name", "po_ref_no", "po_date", "items"],
        properties: {
          client_name: { type: "string" },
          po_ref_no: { type: "string" },
          po_date: { type: "string", example: "2026-01-15" },
          payment_terms: { type: "string" },
          delivery_terms: { type: "string" },
          items: { type: "array", items: { $ref: "#/components/schemas/ContractItem" } },
        },
      },
      Contract: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          clientName: { type: "string" },
          poRefNo: { type: "string" },
          poDate: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["DRAFT", "FINALIZED", "ARCHIVED"] },
          fieldData: { $ref: "#/components/schemas/ContractPayload" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/api/organisations": {
      get: { summary: "List organisations", responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create an organisation",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, slug: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": { description: "Created" }, "400": { description: "Validation failed" } },
      },
    },
    "/api/contracts": {
      get: {
        summary: "Search contracts (filter + paginate)",
        parameters: [
          { $ref: "#/components/parameters/OrgId" },
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "FINALIZED", "ARCHIVED"] } },
          { name: "clientName", in: "query", schema: { type: "string" }, description: "Partial, case-insensitive match" },
          { name: "contractId", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Paginated contracts" } },
      },
      post: {
        summary: "Upload + validate a contract",
        parameters: [{ $ref: "#/components/parameters/OrgId" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ContractPayload" } } },
        },
        responses: { "201": { description: "Created" }, "400": { description: "Validation failed" } },
      },
    },
    "/api/contracts/{id}": {
      get: {
        summary: "Get contract detail",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
      patch: {
        summary: "Update a DRAFT contract",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ContractPayload" } } } },
        responses: { "200": { description: "OK" }, "409": { description: "Not a draft" } },
      },
      delete: {
        summary: "Soft-delete a DRAFT contract",
        description: "Marks the contract deleted (retains the row and audit trail); it is then hidden from reads and listings but remains traceable via contract_events.",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Deleted" }, "409": { description: "Not a draft" } },
      },
    },
    "/api/contracts/{id}/finalize": {
      post: {
        summary: "DRAFT -> FINALIZED",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "409": { description: "Invalid transition" } },
      },
    },
    "/api/contracts/{id}/archive": {
      post: {
        summary: "FINALIZED -> ARCHIVED",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "409": { description: "Invalid transition" } },
      },
    },
    "/api/contracts/{id}/events": {
      get: {
        summary: "Contract audit history",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/contracts/{id}/attachments": {
      get: {
        summary: "List attachments",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Upload a PDF attachment",
        parameters: [{ $ref: "#/components/parameters/OrgId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: { "201": { description: "Created" }, "400": { description: "Invalid file" } },
      },
    },
  },
} as const;
