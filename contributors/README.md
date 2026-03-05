# Adding Yourself as a Contributor

Each contributor has their **own file** — no merge conflicts when multiple people add themselves.

## Steps

1. Copy `contributors/people/_example.json` to `contributors/people/yourusername.json`
2. Edit your file with your info:

```json
{
  "name": "Your Display Name",
  "title": "Your role or title",
  "description": "A short description of what you contributed.",
  "avatar": "",
  "github": "https://github.com/yourusername"
}
```

3. Rebuild the contributors list:

```bash
node scripts/build-contributors.js
```

4. Submit a pull request (include both your `.json` file and the updated `contributors.js`)

**Tips:**
- Leave `avatar` empty to use your GitHub avatar automatically
- Keep the description to 1–2 sentences
- Files starting with `_` (like `_example.json`) are ignored by the build
