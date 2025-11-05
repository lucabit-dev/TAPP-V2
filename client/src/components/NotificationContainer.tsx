import React from 'react';
import Notification from './Notification';
import type { NotificationProps } from './Notification';

interface NotificationContainerProps {
  notifications: NotificationProps[];
  onRemove: (id: string) => void;
}

const NotificationContainer: React.FC<NotificationContainerProps> = ({ notifications, onRemove }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col-reverse">
      {notifications.map(notification => (
        <Notification
          key={notification.id}
          {...notification}
          onClose={onRemove}
        />
      ))}
    </div>
  );
};

export default NotificationContainer;

