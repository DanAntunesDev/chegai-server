import type { INestApplication } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';

type JsonSchema = Record<string, unknown>;
type Operation = {
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: JsonSchema }[];
  requestBody?: unknown;
};

const BODY = Number(RouteParamtypes.BODY);
const QUERY = Number(RouteParamtypes.QUERY);

interface RouteArgument {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

function toSchema(pipe: ZodValidationPipe<unknown>): JsonSchema {
  return z.toJSONSchema(pipe.schema, { io: 'input', unrepresentable: 'any' });
}

function zodArguments(app: INestApplication) {
  const discovery = app.get(DiscoveryService);
  const found = new Map<string, { body?: JsonSchema; query?: JsonSchema }>();

  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as (new (...args: never[]) => object) | undefined;
    if (!metatype) {
      continue;
    }
    for (const method of Object.getOwnPropertyNames(metatype.prototype)) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, method) as
        Record<string, RouteArgument> | undefined;
      if (!args) {
        continue;
      }
      const entry: { body?: JsonSchema; query?: JsonSchema } = {};
      for (const [key, argument] of Object.entries(args)) {
        const type = Number(key.split(':')[0]);
        const pipe = argument.pipes?.find((item) => item instanceof ZodValidationPipe) as
          ZodValidationPipe<unknown> | undefined;
        if (!pipe) {
          continue;
        }
        if (type === BODY) {
          entry.body = toSchema(pipe);
        } else if (type === QUERY) {
          entry.query = toSchema(pipe);
        }
      }
      if (entry.body || entry.query) {
        found.set(`${metatype.name}_${method}`, entry);
      }
    }
  }
  return found;
}

function enrich(document: OpenAPIObject, schemas: ReturnType<typeof zodArguments>) {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as Operation[]) {
      const entry = operation.operationId ? schemas.get(operation.operationId) : undefined;
      if (!entry) {
        continue;
      }
      if (entry.body) {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: entry.body } },
        };
      }
      const properties = entry.query?.properties as Record<string, JsonSchema> | undefined;
      if (properties) {
        const required = new Set((entry.query?.required as string[] | undefined) ?? []);
        operation.parameters = [
          ...(operation.parameters ?? []).filter((parameter) => parameter.in !== 'query'),
          ...Object.entries(properties).map(([name, schema]) => ({
            name,
            in: 'query',
            required: required.has(name),
            schema,
          })),
        ];
      }
    }
  }
  return document;
}

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Chegaí API')
    .setDescription('Agendamento, gestão e WhatsApp para barbearias.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = enrich(SwaggerModule.createDocument(app, config), zodArguments(app));
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as (Operation & { security?: unknown })[]) {
      operation.security = [{ bearer: [] }];
    }
  }
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  return document;
}
