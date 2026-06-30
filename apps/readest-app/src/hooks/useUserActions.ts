import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { navigateToLibrary } from '@/utils/nav';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig: _envConfig } = useEnv();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    // keepLogin setting removed — auth has been disabled
    navigateToLibrary(router);
  };

  const handleResetPassword = () => {
    // Auth removed. TODO: Connect to talebook server authentication.
  };

  const handleUpdateEmail = () => {
    // Auth removed. TODO: Connect to talebook server authentication.
  };

  const handleConfirmDelete = async (errorMessage: string) => {
    try {
      await deleteUser();
      handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
  };
};
