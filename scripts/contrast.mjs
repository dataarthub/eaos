// WCAG relative luminance after sRGB alpha compositing, on the page canvas.
export function contrastRatio(foreground,backgrounds) {
  const over=(fg,bg)=>fg.slice(0,3).map((value,i)=>value*fg[3]+bg[i]*(1-fg[3]))
  const background=backgrounds.reduce((bg,fg)=>over(fg,bg),[255,255,255])
  const text=over(foreground,background)
  const luminance=rgb=>rgb.map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,value,i)=>sum+value*[0.2126,0.7152,0.0722][i],0)
  const a=luminance(text),b=luminance(background)
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
}
