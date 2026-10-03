// Zod v4 input validation (one schema per write endpoint). Failure messages
// match the controllers' existing 400 texts so behavior is unchanged — bad
// input is now rejected at the edge with a clear 400 instead of reaching
// Firestore. Controllers keep their own guards as defense in depth.
const { z } = require('zod');
const { fail } = require('../util/respond');

const loginSchema = z.object({
  email: z.string({ error: 'Email and password are required.' }).trim().min(1, { error: 'Email and password are required.' }),
  // Passwords may contain spaces — validated, never trimmed.
  password: z.string({ error: 'Email and password are required.' }).min(1, { error: 'Email and password are required.' }),
});

const banSchema = z.object({
  reason: z.string({ error: 'A ban reason is required.' }).trim()
    .min(1, { error: 'A ban reason is required.' })
    .max(200, { error: 'Ban reason must be 200 characters or fewer.' }),
});

const sendSchema = z.object({
  title: z.string({ error: 'Title and body are required.' }).trim()
    .min(1, { error: 'Title and body are required.' })
    .max(200, { error: 'Title must be 200 characters or fewer.' }),
  body: z.string({ error: 'Title and body are required.' }).trim()
    .min(1, { error: 'Title and body are required.' })
    .max(2000, { error: 'Message must be 2000 characters or fewer.' }),
  imageUrl: z.string({ error: 'Image URL is too long.' }).max(2048, { error: 'Image URL is too long.' }).optional().default(''),
});

const templateSchema = z.object({
  title: z.string({ error: 'Title and body are required.' }).trim()
    .min(1, { error: 'Title and body are required.' })
    .max(200, { error: 'Title must be 200 characters or fewer.' }),
  body: z.string({ error: 'Title and body are required.' }).trim()
    .min(1, { error: 'Title and body are required.' })
    .max(2000, { error: 'Message must be 2000 characters or fewer.' }),
  // Same https-or-empty rule as send: an http template image would fail the
  // WHOLE broadcast at send time, so reject it at save time instead.
  imageUrl: z.string({ error: 'Image URL is too long.' }).max(2048, { error: 'Image URL is too long.' }).optional().default('')
    .refine((v) => !v || !v.trim() || v.trim().startsWith('https://'),
      { error: 'Image URL must start with https:// (or leave it empty).' }),
});

// Public app-config settings (feature 04): links must be empty or https (empty =
// not set); version code 0/empty = no forced update; name is display-only.
const httpsOrEmpty = (label) => z.string({ error: label + ' is too long.' })
  .max(2048, { error: label + ' is too long.' })
  .optional().default('')
  .refine((v) => !v || v.trim().startsWith('https://'),
    { error: label + ' must start with https:// (or leave it empty).' });

const settingsSchema = z.object({
  supportLink: httpsOrEmpty('Support link'),
  downloadLink: httpsOrEmpty('App download link'),
  latestVersionCode: z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return 0;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
    return v;
  }, z.number({ error: 'Latest version code must be a whole number.' })
    .int({ error: 'Latest version code must be a whole number.' })
    .min(0, { error: 'Latest version code must be 0 or higher.' })
    .max(1000000000, { error: 'Latest version code is too large.' })),
  latestVersionName: z.string({ error: 'Latest version name is too long.' })
    .max(32, { error: 'Latest version name must be 32 characters or fewer.' })
    .optional().default(''),
});

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues && parsed.error.issues[0];
      return fail(res, 400, (first && first.message) || 'Invalid request.');
    }
    req.body = parsed.data;
    return next();
  };
}

module.exports = { validate, loginSchema, banSchema, sendSchema, templateSchema, settingsSchema };
