import * as React from 'react'
import {Input,Textarea} from '@alneas/appkit-react/tools/ui'
/**
 * Renders a controlled labeled text input or textarea with native length and required constraints.
 * @param props - label/value/onChange plus multiline=false, required=false, max=200 characters and type=text; onChange receives the entered string.
 * @returns A label containing Input or Textarea.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Browser constraints do not replace server validation.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceTextField } from '@alneas/eaos-react/workspace-fields';
 * export function NameField() { const [value, setValue] = React.useState(''); return <WorkspaceTextField label="Name" value={value} onChange={setValue}/>; }
 * ```
 */
export function WorkspaceTextField({label,value,onChange,multiline=false,required=false,max=200,type='text'}:{
/**
 * Human-readable field caption.
 */
  label:string;
/**
 * Controlled field value; the host must update it in response to onChange.
 */
  value:string;
/**
 * Receives the parsed user input; update controlled state in this callback.
 */
  onChange:(value:string)=>void;
/**
 * Render a Textarea when true; defaults to false.
 */
  multiline?:boolean;
/**
 * Native required constraint; defaults to false for WorkspaceTextField.
 */
  required?:boolean;
/**
 * Maximum text length in characters; defaults to 200.
 */
  max?:number;
/**
 * Native text input type; defaults to text.
 */
  type?:string}){
 return <label style={{display:'block',margin:'12px 0'}}>{label}{multiline?<Textarea aria-label={label} required={required} maxLength={max} value={value} onChange={event=>onChange(event.target.value)}/>:<Input aria-label={label} required={required} maxLength={max} type={type} value={value} onChange={event=>onChange(event.target.value)}/>}</label>
}
/**
 * Renders a controlled required numeric input while preserving blank values as NaN.
 *
 * Empty numeric input remains NaN, never an accidental zero amount.
 * @param props - label/value/onChange with min=0, max=1000000000000 and step=any; onChange receives a number or NaN when cleared.
 * @returns A labeled numeric Input; nonfinite values render blank.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { WorkspaceNumberField } from '@alneas/eaos-react/workspace-fields';
 * export function AmountField() { const [value, setValue] = React.useState(NaN); return <WorkspaceNumberField label="Amount" value={value} onChange={setValue}/>; }
 * ```
 */
export function WorkspaceNumberField({label,value,onChange,min=0,max=1e12,step='any'}:{
/**
 * Human-readable field caption.
 */
  label:string;
/**
 * Controlled field value; the host must update it in response to onChange.
 */
  value:number;
/**
 * Receives the parsed user input; update controlled state in this callback.
 */
  onChange:(value:number)=>void;
/**
 * Numeric lower bound; defaults to 0.
 */
  min?:number;
/**
 * Numeric upper bound; defaults to 1000000000000.
 */
  max?:number;
/**
 * Numeric input increment string; defaults to any.
 */
  step?:string}){
 return <label style={{display:'block',margin:'12px 0'}}>{label}<Input aria-label={label} required type="number" min={min} max={max} step={step} value={Number.isFinite(value)?value:''} onChange={event=>onChange(event.target.value===''?NaN:Number(event.target.value))}/></label>
}
