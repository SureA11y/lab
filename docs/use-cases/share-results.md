# Share results

**For** whoever has to get results to people who do not run the lab:
developers, product owners, a client, an auditor. **You get** files that open
anywhere, and links that open in the lab.

| What | How | What the reader gets |
| --- | --- | --- |
| A report | **Download report** in the app | A zip: the report as a page to read, its JSON to open again in the lab, its pictures, and the configuration it ran |
| A report, as one file | **Download report** › **Download as a single file** | One HTML file with everything inline, to attach or mail |
| A comparison | **Download comparison** in the compare tab | One HTML file with the comparison |
| A comparison and its reports | **Download comparison** › **Download with the reports (zip)** | A zip that opens in the compare tab as it was, to continue from |
| A run from the command line | Its folder | `summary.md` to read, `comparison.html` when compared, `payload.json` to open in the lab |
| A batch | **Download all (zip)** in the queue, or the batch's folder | Every run's report, with their pictures once, and the batch's configuration |
| A link | `http://<lab>/?report=<url>` or `?compare=<url>&compare=<url>` | The report or the comparison, open in the lab app ([how](../http-api.md#opening-reports-in-the-app-by-address)) |

The downloaded pages work offline, with no lab behind them. Name a report or
a comparison before downloading it: the name becomes its title and its file
name.

## See also

[Reports and their format](../report-package.md) ·
[The lab app: downloading and sharing](../app.md#downloading-and-sharing)
