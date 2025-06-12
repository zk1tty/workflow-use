import React from 'react';
import { useAuth } from '../context/auth-provider';

export const InitialView: React.FC = () => {
  const { signIn } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h1 className="mb-4 text-xl">⏺️ Rebrowse Recorder</h1>
      <button
        className="bg-black text-white px-4 py-2 rounded"
        onClick={signIn}
      >
        Sign in with Google
      </button>
    </div>
  );
};
