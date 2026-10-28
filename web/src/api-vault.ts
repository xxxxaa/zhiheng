import {z} from 'zod';
// Old vaults contain only model and search keys; adding Miaoxiang must not break unlock.
export const apiKeysSchema=z.object({apiKey:z.string(),searchKey:z.string(),mxKey:z.string().default('')});
