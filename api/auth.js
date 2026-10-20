import { handleSocialAuth } from '../server/social-auth.mjs';

export const GET = (request) => handleSocialAuth(request);
