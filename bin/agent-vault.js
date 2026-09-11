#!/usr/bin/env node
import { createCli } from '../dist/index.js';

const cli = createCli();
cli.parse(process.argv);
