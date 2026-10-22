#!/usr/bin/env node
import path from 'node:path';
import { artifactQueryManifest, ACTIVE_STATE_PROFILE } from '../../src/application/runtime/artifact-query-catalog.mjs';
import { artifactQueryEnvelope, readArtifactQueryParams, queryProjectArtifacts } from '../../src/application/runtime/artifact-query-service.mjs';

export async function main(argv=process.argv.slice(2)) {
  if(argv.includes('--help')||argv.includes('-h')){
    console.log('Experimental, read-only: aidn runtime artifact-query --profile active-state.v1 --params-file <worktree-relative.json> --json');
    console.log('Parameters: {"schema_version":1}; optional scope, expected_revision, target_bytes (256..65536), include_optional.');
    console.log('Discover contract-bound fields with --manifest --json. Facts never replace required authorities or fresh admission.');return;
  }
  let output=artifactQueryEnvelope();
  try {
    const options={},seen=new Set();
    for(let i=0;i<argv.length;i++){
      const flag=argv[i];if(seen.has(flag))throw new Error('ARTIFACT_QUERY_ARGUMENT_DUPLICATE');seen.add(flag);
      if(['--json','--manifest'].includes(flag))options[flag]=true;
      else if(['--target','--profile','--params-file'].includes(flag)){
        const value=argv[++i];if(!value||value.startsWith('--'))throw new Error('ARTIFACT_QUERY_ARGUMENT_MISSING');options[flag]=value;
      }else throw new Error('ARTIFACT_QUERY_ARGUMENT_UNSUPPORTED');
    }
    if(!options['--json'])throw new Error('ARTIFACT_QUERY_JSON_REQUIRED');
    if(options['--manifest']){
      if(options['--profile']||options['--params-file'])throw new Error('ARTIFACT_QUERY_ARGUMENT_CONFLICT');
      output.status='manifest';output.profile=null;output.manifest=artifactQueryManifest();output.catalog_revision=output.manifest.revision;
    }else{
      if(options['--profile']!==ACTIVE_STATE_PROFILE)throw new Error('ARTIFACT_QUERY_PROFILE_UNSUPPORTED');
      if(!options['--params-file'])throw new Error('ARTIFACT_QUERY_PARAMS_REQUIRED');
      const targetRoot=path.resolve(options['--target']??'.');
      const params=readArtifactQueryParams(targetRoot,options['--params-file']);
      output=await queryProjectArtifacts({targetRoot,params,profile:options['--profile']});
    }
  }catch(error){
    // Backend errors can contain credentials. Only owned typed codes cross this boundary.
    const code=/^ARTIFACT_QUERY_[A-Z_]+$/.test(error.message)?error.message:'ARTIFACT_QUERY_CANONICAL_UNAVAILABLE';
    output=artifactQueryEnvelope();output.errors.push({code,ref:null});
  }
  console.log(JSON.stringify(output));
  if(!['ok','manifest'].includes(output.status))process.exitCode=2;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename))await main();
