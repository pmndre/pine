# Signing the Windows app

The Pine app for Windows is signed with SignPath Foundation's certificate for open-source projects,
from the release workflow (`.github/workflows/release.yml`, jobs `app-windows` and
`app-windows-sign`). Nothing is signed on anybody's computer, and no Windows computer is needed.

A release asks for two approvals at signpath.io: one for the app's two folders (x64 and arm64),
one for the two installers made from them. SignPath sends an e-mail for each; the job waits up to
two hours for each one.

## What is signed

Only what is built from this repository's source: `Pine.exe`, pine's three C# helpers
(`pine-system-*.exe`, `pine-voice-*.exe`, `pine-computer-*.exe`) and the installers. Electron's
DLLs, Node (`node.exe`, signed by nodejs.org) and the terminal's native module come from their own
projects and are left as they are: SignPath Foundation signs a project's own binaries only.

SignPath checks that every file it signs says it is "Pine" in the release's version. The packer
writes that into `Pine.exe` and the installers (`desktop/scripts/pack.mjs`), `src/csharp.ts` into
the helpers, and the `pack` job of `test.yml` checks all five files on Windows. Each says the
version as text ("0.41.0", which is what the configurations compare with `${version}`) and as the
four numbers Windows keeps beside it (0.41.0.0). Should SignPath compare the four numbers, change
`product-version="${version}"` to `product-version="${version}.0"` in both configurations.

## Setting it up, once

1. **Apply** at <https://signpath.org/apply> for the repository `pmndre/pine` (MIT licence). The
   README's "Code signing policy" section is what their terms ask the home page to show, and each
   release's notes link to it.
2. **Multi-factor authentication** on GitHub and on SignPath for everyone in the policy (their
   terms require it).
3. In the organization SignPath Foundation makes for the project ("pine [OSS]"; the project
   `pine`, GitHub.com linked as its trusted build system, the policies `test-signing` and
   `release-signing` and the CI user "CI builds" come with it):
   - **Artifact configurations:** two, with the slugs `app-folder` and `installer`, each with the
     XML of the file of that name here.
   - **The CI user's API token:** Users and Groups → CI builds → Regenerate token (shown once).
4. **Secrets** in the GitHub environment `signing-trial`, for the trial below:

   | Secret                     | Value                                              |
   | -------------------------- | -------------------------------------------------- |
   | `SIGNPATH_API_TOKEN`       | the CI user's API token                            |
   | `SIGNPATH_ORGANIZATION_ID` | the organization's ID (its page, a GUID)           |
   | `SIGNPATH_PROJECT_SLUG`    | `pine`                                             |
   | `SIGNPATH_POLICY_SLUG`     | `test-signing`                                     |

   Without all four a release's installers are uploaded unsigned and the job says so, and a trial
   fails; with only some, both fail.
5. **The trial:** `gh workflow run release.yml --ref <branch> -f version=0.0.1 -f
   signing_trial=true` packs both apps from that branch, has them and their installers signed with
   the test certificate (no approval) and keeps the result as an artifact of the run. SignPath
   Foundation looks at a trial that went through before it orders the real certificate.
6. **Once the certificate is in** (the policy `release-signing` is valid): "Use approval process"
   with yourself as approver and "Verify origin" with the branch `main` on that policy, and the
   same four secrets in the environment `release`, the last one `release-signing`. From then on
   every release from `main` asks for its two approvals.

To build a release's apps again: `gh workflow run release.yml -f version=<the last release>` from
`main` builds them from that release's tag and uploads them to it.
