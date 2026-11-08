# Tabler

Tabler is the database-website and sales-funnel app of [Lucian Office](https://github.com/luciangreen/lucianoffice), running inside [LucianOS](https://github.com/luciangreen/lucianos).

- **Sites**: tables (with formula columns), reports (filter, group, count/sum/average/min/max, sort, limit), variables (`{{name}}`) and pages. Tabler writes the whole site as one SWI-Prolog program: the data are facts and the pages are served by `library(http/thread_httpd)`. Forms add rows, which are saved to `tabler_data.pl` and come back after a restart.
- **Funnels**: a landing page with sign-up fields, an offer, and thanks or declined pages. Tabler writes the funnel as a terminal Prolog program and [vetusiapl2webpl](https://github.com/luciangreen/vetusiapl2webpl) turns it into a web server. Each visit, sign-up, checkout and decline is recorded in `funnel_events.pl`.
- **Tracking**: sales are read from Stripe, PayPal or Square (chosen per funnel), matched to sign-ups by email, and reported with sign-up and checkout rates, revenue, profit, return on ad spend and cost per sign-up. Keys are passed to the job on standard input, never on the command line or in the page.
- **Publishing**: run on this computer first; when you give a server's details, the same files are copied over with `scp` and started with `ssh`.

Algorithms do the work; Claude is optional and off by default.

## Using it

- **Pages, Tables, Reports, Variables**: edit the site, with a live preview beside it (stacked on a phone). Formula columns such as `price * stock` are worked out in the preview and in Prolog alike.
- **Funnel**: the landing page, sign-up fields, offer, thanks page with your payment link (a Stripe Payment Link, PayPal button link or Square checkout link) and the declined page. **Refresh figures** counts visits, sign-ups and choices from `funnel_events.pl`, reads sales from your provider and matches them by email.
- **Publish**: **Run site** and **Run funnel** start them on this computer (ports 8095 and 8097 by default). Enter a server you reach with ssh to copy them there; **Check (dry run)** shows the commands first.
- Tell the character things like "add a table called customers with name, email and spend (number)", "add a row to customers: name Ann, email ann@example.com, spend 120", "make a report of total value in products by category", "set the price to $49", "use PayPal for payments" or "how is the funnel doing". "Undo that" takes back its last change.

### Payment keys

Press **Make the keys file** in the Funnel tab. It creates `~/.lucianoffice/payment-keys.json` with empty entries for Stripe (`secretKey`: a restricted key with read access to charges is enough), PayPal (`clientId`, `secret`) and Square (`accessToken`); add `"sandbox": "yes"` for test accounts. Fill it in with iEdit. Tabler only reads it from a job on this computer (`scripts/fetch-sales.mjs`), so the keys never appear in the page or on a command line.

## Install

From your `lucianos` folder (see the Lucian Office README for everything at once):

```sh
git clone https://github.com/luciangreen/lucianoffice apps/lucianoffice
git clone https://github.com/luciangreen/tabler apps/tabler
git clone https://github.com/luciangreen/vetusiapl2webpl ../vetusiapl2webpl
```

Needs Node 20 and SWI-Prolog (`swipl`).

vetusiapl2webpl needs the fixes in [luciangreen/vetusiapl2webpl#19](https://github.com/luciangreen/vetusiapl2webpl/pull/19) (raw HTML on form pages, the step before the first prompt, typed fields as strings); until it is merged, check out its `fix-web-html-and-inputs` branch.

## Tests

```sh
npm test                                   # unit tests
npm run check-site                         # the generated site in SWI-Prolog equals the preview
VETUSIA_DIR=../vetusiapl2webpl npm run check-funnel   # the funnel through vetusiapl2webpl
```
