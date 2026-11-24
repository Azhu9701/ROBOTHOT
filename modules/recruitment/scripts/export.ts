import {closeDb} from '@aihot/backend/db';
import {exportRecruitment} from '../backend/transfer.ts';
try{process.stdout.write(JSON.stringify(await exportRecruitment()));}finally{await closeDb();}
