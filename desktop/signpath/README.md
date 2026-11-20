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
3. In SignPath, once the organization is set up:
   - **Trusted build system:** Trusted Build Systems → Add predefined → GitHub.com, then link it to
     the project. Install the SignPath GitHub App on `pmndre/pine` if it asks for it.
   - **Project:** repository URL `https://github.com/pmndre/pine`. Its slug is a secret below.
   - **Artifact configurations:** two, with the slugs `app-folder` and `installer`, each with the
     XML of the file of that name here.
   - **Signing policy** (release signing, the Foundation's certificate): "Verify origin" with
     allowed branch `main` (a release is made from `main`), "Use approval process" with yourself as
     approver, and a **CI user** as its only submitter. Its slug is a secret below.
   - **The CI user's API token** (shown once).
4. **Secrets** in the GitHub environment `release` (Settings → Environments → release):

   | Secret                     | Where it is in SignPath                         |
   | -------------------------- | ----------------------------------------------- |
   | `SIGNPATH_API_TOKEN`       | the CI user's API token                         |
   | `SIGNPATH_ORGANIZATION_ID` | the organization's page (its ID, a GUID)        |
   | `SIGNPATH_PROJECT_SLUG`    | the project's settings                          |
   | `SIGNPATH_POLICY_SLUG`     | the release signing policy                      |

   Without all four the Windows jobs build nothing and say so; with only some they fail.

To try it without a new release: `gh workflow run release.yml -f version=<the last release>` from
`main` builds the apps of that release again and uploads them to it.
