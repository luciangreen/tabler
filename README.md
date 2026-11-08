# Tabler

Tabler is the database-website and sales-funnel app of [Lucian Office](https://github.com/luciangreen/lucianoffice), running inside [LucianOS](https://github.com/luciangreen/lucianos).

- **Sites**: tables (with formula columns), reports (filter, group, count/sum/average/min/max, sort, limit), variables (`{{name}}`) and pages. Tabler writes the whole site as one SWI-Prolog program: the data are facts and the pages are served by `library(http/thread_httpd)`. Forms add rows, which are saved to `tabler_data.pl` and come back after a restart.
- **Funnels**: a landing page with sign-up fields, an offer, and thanks or declined pages. Tabler writes the funnel as a terminal Prolog program and [vetusiapl2webpl](https://github.com/luciangreen/vetusiapl2webpl) turns it into a web server. Each visit, sign-up, checkout and decline is recorded in `funnel_events.pl`.
- **Tracking**: sales are read from Stripe, PayPal or Square (chosen per funnel), matched to sign-ups by email, and reported with sign-up and checkout rates, revenue, profit, return on ad spend and cost per sign-up. Keys are passed to the job on standard input, never on the command line or in the page.
- **Publishing**: run on this computer first; when you give a server's details, the same files are copied over with `scp` and started with `ssh`.

Algorithms do the work; Claude is optional and off by default.

## Install

From your `lucianos` folder (see the Lucian Office README for everything at once):

```sh
git clone https://github.com/luciangreen/lucianoffice apps/lucianoffice
git clone https://github.com/luciangreen/tabler apps/tabler
git clone https://github.com/luciangreen/vetusiapl2webpl ../vetusiapl2webpl
```

Needs Node 20 and SWI-Prolog (`swipl`).

## Tests

```sh
npm test                                   # unit tests
npm run check-site                         # the generated site in SWI-Prolog equals the preview
VETUSIA_DIR=../vetusiapl2webpl npm run check-funnel   # the funnel through vetusiapl2webpl
```
