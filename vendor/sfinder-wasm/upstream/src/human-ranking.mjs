// Human-friendliness v1 is produced by the structural Rust enumerator:
// orderCount = number of distinct piece-type placement orders that actually
// reach this solution under the concrete queue + Hold rules.
//
// For matrix minimals the same geometry can have a different orderCount in
// different queue cases, so quality is indexed by (caseId, solutionKey).

export function recordOrderCount(index,caseId,solution){
  let byKey=index.get(caseId);
  if(!byKey){byKey=new Map();index.set(caseId,byKey)}
  const value=Number(solution?.orderCount??0);
  const previous=byKey.get(solution.key)??0;
  if(value>previous)byKey.set(solution.key,value);
}

export function makeOrderCountQuality(index){
  return(key,caseId)=>index.get(caseId)?.get(key)??0;
}
