import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DeviceGate from './DeviceGate';
import './style.css';
import {startPwa} from './pwa';
startPwa();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><DeviceGate><App/></DeviceGate></React.StrictMode>);
