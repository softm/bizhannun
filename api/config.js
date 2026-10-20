import { handlePublicConfig } from '../server/config.mjs';

export const GET = (request) => handlePublicConfig(request);
export const OPTIONS = (request) => handlePublicConfig(request);
