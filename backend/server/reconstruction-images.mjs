export function reconstructionImages(input){
 if(input.localRefine)return [input.image,input.repairMask,...(input.referenceImage?[input.referenceImage]:[])];
 if(input.controlledRepair)return [input.image,input.referenceImage];
 if(input.referenceMode==='rectified-only')return [input.image];
 return input.evidenceMode==='context-only'?[input.contextImage]:[input.contextImage,input.image,...(input.maskImage?[input.maskImage]:[])];
}
