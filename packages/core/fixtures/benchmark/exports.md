Notes from the export review. Big agency customers pull monthly CSV exports
of every project. The old synchronous download timed out above fifty
thousand rows and support kept eating the fallout. We decided CSV exports
run as an async job and the client polls every five seconds until the file
is ready. The spreadsheet link stays valid for a day.
