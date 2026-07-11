import { describe,expect,it } from 'vitest';
import { layoutText } from './textLayout';

describe('text layout',()=>{it('wraps deterministically and preserves paragraphs',()=>{const lines=layoutText({text:'one two three\n\nfour',width:7,fontSize:10,lineHeight:1.2,letterSpacing:0},(text)=>text.length);expect(lines.map((l)=>l.text)).toEqual(['one two','three','','four']);expect(lines[1].y).toBe(12);});});
