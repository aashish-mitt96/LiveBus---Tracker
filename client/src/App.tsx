import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Driver from './pages/Driver';
import TripMap from './pages/Map';
import User from './pages/User';

function App() {

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Driver />} />
        <Route path="/user" element={<User />} />
        <Route path="/tracker/:tripId" element={<TripMap />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App