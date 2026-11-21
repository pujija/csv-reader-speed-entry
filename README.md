# csv-reader-speed-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/pujija/csv-reader-speed-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/pujija/csv-reader-speed-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast exact-match drop-in for csv-reader 1.0.0: reads broken CSV files with the same answers — quoting, CR/LF handling, short/long rows, error codes with line/row — at a fraction of the CPU time. Instead of reading a character at a time, it jumps between delimiters (commas, CR, LF) and slices whole fields out of the text; only quoted fields holding a doubled quote or a line break are rebuilt piece by piece. On the practice set it matches csv-reader on every case and runs about 6x faster on parsing (about 2x end to end including JSON I/O).

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

`main.ts` reads every case from `cases.json` in the input directory, answers each with `run` from `solve.js`, and writes `answers.json` to the output directory. Node 22, JavaScript only, no dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2s3gqqnq&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
