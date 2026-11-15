import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CreateTagInput,
  createTagSchema,
  type UpdateTagInput,
  updateTagSchema,
} from './tags.schemas';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(@CurrentTenant() auth: TenantAuthContext) {
    return this.tags.list(auth);
  }

  @Post()
  create(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createTagSchema)) body: CreateTagInput,
  ) {
    return this.tags.create(auth, body);
  }

  @Patch(':id')
  update(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTagSchema)) body: UpdateTagInput,
  ) {
    return this.tags.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.tags.remove(auth, id);
  }
}
