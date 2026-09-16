#!/usr/bin/env node
import { createCli } from '../dist/index.js';

const cli = createCli();
await cli.parseAsync(process.argv);
