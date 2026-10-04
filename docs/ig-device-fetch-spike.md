# Instagram device-fetch spike (Phase 0)

- Date: 2026-10-04
- Network: developer laptop on a regular home/office connection, NOT mobile data. Re-run on a phone hotspot to confirm the carrier-network result before relying on it at scale.
- Client identity: OkHttp default User-Agent, Accept-Language only, no cookies (same as the Android fetcher)
- URLs probed: 30

## Results

| Metric | Count | % |
|---|---|---|
| HTTP 200 | 30 | 100% |
| Login wall / 429 | 0 | 0% |
| og:description present | 30 | 100% |
| og:image present | 30 | 100% |
| og:title present | 30 | 100% |
| Location data visible | 0 | 0% |
| Usable caption (full or truncated) | 29 | 97% |
| of which full | 29 | 97% |
| of which truncated | 0 | 0% |

## Notes

- The one miss is a post with no caption (description is only likes/comments/date), not a wall or parse failure.
- 30 sequential requests ~1.5s apart say nothing about behaviour at volume; the app disables itself for 24h after 3 walls/429s.
- Location data was not visible logged-out on any URL (0%): device fetch gives caption, author and thumbnail only.

## Decision

**GO**: rule is usable caption on >= 40% of >= 30 URLs.

- GO: build the Android app with `IG_DEVICE_FETCH=true` and watch the weekly metrics (spec section 7):
  keep it only if it removes >= 30% of provider calls.
- NO-GO: leave `IG_DEVICE_FETCH` unset (the default). Cache, provider chain and canary stand on their own.

## Per-URL

| URL | HTTP | Wall | Caption | og:image | Location | Note |
|---|---|---|---|---|---|---|
| https://www.instagram.com/reel/DWlvIGEEy1N/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DbYLgt4Mt6s/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DWUUBE1EwXi/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DYcJo5ktNRL/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DdORgkQhB-j/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DULI9WGEukz/ | 200 | no | none | y | n |  |
| https://www.instagram.com/reel/DQWTJ8bEldp/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DPElFKjkgQQ/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DMCa88PSR-f/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DdA0bXxxURd/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Dc7Ugn4hewC/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Dc06eoOPkAU/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DMOxFSqyg4P/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/C1UD-Blvtm4/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DXvs3iexkT2/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DGSxEKZpCRy/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DaetYgbydt4/ | 200 | no | full | y | n |  |
| https://www.instagram.com/p/B8vk6OngUoW/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Czd5mUEvNys/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DbDk0rnNs1R/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DdC-i_ZTfwP/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Dc7Lp1iNIoN/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DbddPoLp24A/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DQOufLJEkZu/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DV9_JfNEply/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Da-MpNYMJvj/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Db8Tde6JBE3/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/Dbiy-iPJ5v9/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DdqBvTeB6KK/ | 200 | no | full | y | n |  |
| https://www.instagram.com/reel/DBk4iF7REa9/ | 200 | no | full | y | n |  |
