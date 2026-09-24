import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./format";

const local = process.argv[2] ?? "";
const iso = fromDateTimeLocalValue(local);
const back = iso ? toDateTimeLocalValue(iso) : null;

process.stdout.write(JSON.stringify({ iso, back }));
