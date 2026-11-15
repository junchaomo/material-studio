import sharp from 'sharp';
export default function imageSharp(input,options={}){const settings={...options,...(process.env.LOCAL_STORAGE_MODE==='true'?{limitInputPixels:false}:{})};return input&&input.constructor===Object?sharp({...input,...settings}):sharp(input,settings);}
