# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gen.spec.ts >> Auth login response includes verified:boolean and does not break Stories feed / Profile navigation
- Location: gen.spec.ts:9:1

# Error details

```
Error: stories GET /api/stories response after login

expect(received).not.toBeNull()

Received: null
```

# Test source

```ts
  51  |       }
  52  |       await logInButton.first().click();
  53  |     } else {
  54  |       throw new Error('Login button not found (neither by role/name nor by recorded selector).');
  55  |     }
  56  | 
  57  |     // Assert: auth-service login response now includes `verified:boolean`
  58  |     // Fix: the previous test waited for a response matching /api/auth/login|/api/login|/auth/login/,
  59  |     // which may not match the real endpoint in the current build.
  60  |     // Instead, we:
  61  |     // 1) wait for ANY json response for likely auth/login endpoints,
  62  |     // 2) if none match quickly, fall back to waiting for the next /api/stories (auth might be handled via a different endpoint),
  63  |     //    but still require we observed some login-like json with `verified`.
  64  |     const loginResponse = await page
  65  |       .waitForResponse((res) => {
  66  |         const url = res.url();
  67  |         const isJson = (res.headers()['content-type'] || '').includes('application/json');
  68  | 
  69  |         // Prefer likely auth endpoints, but be lenient on path differences.
  70  |         const authLike =
  71  |           /\/api\/(auth|login)|\/auth\/login|\/api\/session|\/api\/signin|\/api\/sign-in|\/api\/users\/login/i.test(
  72  |             url
  73  |           );
  74  | 
  75  |         // Some backends may return verified field on session endpoints too.
  76  |         return isJson && res.request().method() === 'POST' && authLike;
  77  |       })
  78  |       .catch(() => null);
  79  | 
  80  |     // If we didn't catch the login response by endpoint, try a broader strategy:
  81  |     // wait for the first json POST response that includes "verified" in the body.
  82  |     let body: any = null;
  83  | 
  84  |     if (loginResponse) {
  85  |       expect(loginResponse.status(), 'login response status').toBeGreaterThanOrEqual(200);
  86  |       body = await loginResponse.json().catch(() => null);
  87  |     } else {
  88  |       // Broad fallback: race a few likely transitions (login could be POST to a non-matching route).
  89  |       // We avoid arbitrary timeouts by using waitForResponse and evaluating response json.
  90  |       const maybeVerified = await page
  91  |         .waitForResponse(async (res) => {
  92  |           const url = res.url();
  93  |           const isJson = (res.headers()['content-type'] || '').includes('application/json');
  94  |           const isPost = res.request().method() === 'POST';
  95  |           const authLike =
  96  |             /\/api\/(auth|login|session|signin|sign-in)|\/auth\/login/i.test(url);
  97  | 
  98  |           if (!isJson || !isPost || !authLike) return false;
  99  | 
  100 |           try {
  101 |             const json = await res.clone().json();
  102 |             return json && typeof json === 'object' && 'verified' in json;
  103 |           } catch {
  104 |             return false;
  105 |           }
  106 |         })
  107 |         .catch(() => null);
  108 | 
  109 |       expect(maybeVerified, 'login response containing verified').not.toBeNull();
  110 |       if (maybeVerified) {
  111 |         expect(maybeVerified.status(), 'login response status').toBeGreaterThanOrEqual(200);
  112 |         body = await maybeVerified.json().catch(() => null);
  113 |       }
  114 |     }
  115 | 
  116 |     expect(body, 'login response body should be JSON and parseable').toBeTruthy();
  117 |     // Change under test: verified boolean field exists
  118 |     expect(body).toHaveProperty('verified');
  119 |     expect(typeof body.verified).toBe('boolean');
  120 |   });
  121 | 
  122 |   test.step('Load Stories Feed', async () => {
  123 |     // The previous failure was caused by waiting for a specific response URL:
  124 |     //   /\/api\/stories(\?|$)/
  125 |     // In this build the stories endpoint may include host, extra path, or different query params.
  126 |     // We keep the same real intent (GET /api/stories) but broaden the matcher to include `/api/stories` anywhere.
  127 |     // Also, we trigger a stories reload if needed by navigating to a known "stories" UI entry point.
  128 |     const storiesUrlRe = /\/api\/stories(?:[/?#]|$)/i;
  129 | 
  130 |     // Ensure some logged-in UI marker is visible before we expect stories to load.
  131 |     // (Recorded flow used "stories" text assertion later; do it here to reduce flakiness.)
  132 |     const storiesNavCandidate = page.getByText(/stories/i).first();
  133 |     if (await storiesNavCandidate.count().catch(() => 0)) {
  134 |       await expect(storiesNavCandidate).toBeVisible();
  135 |     }
  136 | 
  137 |     // Try to (re)load stories if the app has a stories navigation element.
  138 |     // If it doesn't exist, the subsequent waitForResponse still works for auto-load on login.
  139 |     const storiesLink = page.getByRole('link', { name: /stories/i }).first();
  140 |     if ((await storiesLink.count().catch(() => 0)) > 0) {
  141 |       await storiesLink.click();
  142 |     }
  143 | 
  144 |     const storiesResponse = await page
  145 |       .waitForResponse((res) => {
  146 |         const url = res.url();
  147 |         return storiesUrlRe.test(url) && res.request().method() === 'GET' && !/\/api\/stories\/\d+/i.test(url);
  148 |       })
  149 |       .catch(() => null);
  150 | 
> 151 |     expect(storiesResponse, 'stories GET /api/stories response after login').not.toBeNull();
      |                                                                                  ^ Error: stories GET /api/stories response after login
  152 |     if (!storiesResponse) return;
  153 | 
  154 |     expect(storiesResponse.status(), 'stories response status').toBeGreaterThanOrEqual(200);
  155 | 
  156 |     const storiesBody = await storiesResponse.json();
  157 |     expect(storiesBody).toHaveProperty('stories');
  158 |     expect(Array.isArray(storiesBody.stories)).toBe(true);
  159 | 
  160 |     // Risk guard: verify at least one story from sample shape is present
  161 |     const first = storiesBody.stories[0];
  162 |     expect(first).toHaveProperty('id');
  163 |     expect(first).toHaveProperty('caption');
  164 |     expect(first).toHaveProperty('username');
  165 |     expect(first).toHaveProperty('post_date');
  166 |   });
  167 | 
  168 |   test.step('Navigate to Profile Page', async () => {
  169 |     // Risk guard: after login, app remains functional. Then attempt profile navigation if a link exists.
  170 |     // Recorded flow did not provide selectors; keep generic but real and robust.
  171 |     await expect(page.getByText(/stories/i).first()).toBeVisible();
  172 | 
  173 |     const profileLink = page.getByRole('link', { name: /profile/i }).first();
  174 |     if ((await profileLink.count().catch(() => 0)) > 0) {
  175 |       await profileLink.click();
  176 |       await expect(page.getByText(/profile/i).first()).toBeVisible();
  177 |     } else {
  178 |       // If no "Profile" link exists, verify that user-dependent UI still renders.
  179 |       // Use a generic authenticated marker if present.
  180 |       const userChip = page.getByText(/@|profile|account|logout/i).first();
  181 |       if ((await userChip.count().catch(() => 0)) > 0) {
  182 |         await expect(userChip).toBeVisible();
  183 |       }
  184 |     }
  185 |   });
  186 | });
```