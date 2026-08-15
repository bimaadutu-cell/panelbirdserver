# BirdServer V11 — Railway deploy fix

## Root cause addressed
The Railway build was failing on Linux with:

`Module not found: Can't resolve '@/components/layout/Sidebar'`

The component existed in the source ZIP, but the deployment path was vulnerable to a Git case/rename mismatch. The component is now stored as lowercase `src/components/layout/sidebar.tsx`, and every import uses the exact lowercase path.

Also added `next-env.d.ts`, which is expected by the Next.js TypeScript project.

## Railway
Use the repository root containing `package.json` and `src/`.

Build command:
`npm run build`

Start command:
`npm start`

Before pushing:
`git add -A`
`git status`
`git commit -m "fix: railway linux build and sidebar import"`
`git push`

If Railway still shows the OLD `Sidebar` error, it is building an old Git commit. Trigger a new deployment from the newest commit.
