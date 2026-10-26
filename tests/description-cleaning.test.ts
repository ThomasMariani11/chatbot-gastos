import {describe,expect,it} from 'vitest';
import {cleanDescription} from '../supabase/functions/whatsapp-webhook/movement-description';
describe('BE-04: conceptos numéricos no son montos',()=>{
 it.each(['iPhone 15','Colectivo 60','Ruta 9','Local 24','7 Up','Tornillos 10/10','Licencia 2026-10-20','Peugeot 208'])('conserva %s',text=>{
   expect(cleanDescription(text,'expense')).toBe(text.charAt(0).toUpperCase()+text.slice(1));
   expect(cleanDescription('Compré '+text,'expense')).toBe(text.charAt(0).toUpperCase()+text.slice(1));
 });
 it.each([
  ['Gasté 15000 pesos en supermercado','Supermercado'],
  ['Pagué $15000 en supermercado','Supermercado'],
  ['Cobré USD 100 por diseño','Diseño'],
  ['Me ingresó 80000 por trabajo','Trabajo'],
  ['Compré 15000 en iPhone 15','IPhone 15'],
  ['Supermercado 15000 pesos','Supermercado'],
  ['iPhone 15 USD 100','IPhone 15'],
  ['Ruta 9 1500 ARS','Ruta 9'],
 ])('quita solo el importe explícito: %s',(text,expected)=>expect(cleanDescription(text,'expense')).toBe(expected));
 it('conserva un número final sin unidad aunque coincida con un monto posible',()=>{
   expect(cleanDescription('Supermercado 15000','expense')).toBe('Supermercado 15000');
   expect(cleanDescription('Diseño 2026','income')).toBe('Diseño 2026');
 });
 it('mantiene los conceptos vacíos de respaldo',()=>{
   expect(cleanDescription('','expense')).toBe('Gasto general');expect(cleanDescription('','income')).toBe('Ingreso general');
 });
});
