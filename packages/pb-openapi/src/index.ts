/**
 * `@be-certain/pb-openapi`
 *
 * Single source of truth for the BeCertain PocketBase API:
 *
 *   - `spec.yaml`     — OpenAPI 3.1 spec (authoritative contract)
 *   - `./types`       — TypeScript types matching the spec
 *   - `./constants`   — label taxonomies + paywall message constants
 *
 * To consume:
 *
 *   import type { AnalysisResponse, XrayResponse } from '@be-certain/pb-openapi/types';
 *   import { DISEASE_LABELS, PAYWALL_MESSAGES } from '@be-certain/pb-openapi/constants';
 */

export * from './types.js';
export * from './constants.js';
