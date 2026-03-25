import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Driver from './pages/Driver';
import User from './pages/User';
import TripMap from './pages/TripMap';

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Driver />} />
        <Route path="/track" element={<User />} />
        <Route path="/tracker/:tripId" element={<TripMap />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App