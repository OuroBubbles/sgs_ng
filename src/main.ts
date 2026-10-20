import { mount } from 'svelte';
// 安装 Pixi 的无动态求值适配，兼容原生应用壳的生产 CSP。
import 'pixi.js/unsafe-eval';
import App from './app/App.svelte';
import './client/style.css';
import './client/refinements.css';
import './client/table/surface.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('缺少应用挂载点。');
}

mount(App, { target });
