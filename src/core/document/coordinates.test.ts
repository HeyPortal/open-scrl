import { describe,expect,it } from 'vitest';
import { newDocument } from '@/editor/documentStore';
import { getLayerGlobalBounds,getVisibleLayerIds } from './coordinates';

describe('global coordinates',()=>{
  it('uses slide order and includes spanning layers',()=>{const doc=newDocument({name:'Square',width:100,height:100});doc.slideOrder=['a','b'];doc.slides={a:{id:'a',background:{kind:'solid',color:'#fff'},layerOrder:[]},b:{id:'b',background:{kind:'solid',color:'#fff'},layerOrder:['l']}};doc.layers={l:{id:'l',kind:'shape',name:'wide',x:-20,y:0,width:50,height:20,rotation:0,opacity:1,visible:true,locked:false,shape:'rect',fill:'#000',stroke:'#000',strokeWidth:0,cornerRadius:0}};expect(getLayerGlobalBounds(doc,'l')?.x).toBe(80);expect(getVisibleLayerIds(doc,{x:0,y:0,width:100,height:100})).toEqual(['l']);doc.slideOrder.reverse();expect(getLayerGlobalBounds(doc,'l')?.x).toBe(-20);});
});
