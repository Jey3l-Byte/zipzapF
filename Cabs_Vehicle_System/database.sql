CREATE DATABASE IF NOT EXISTS cabs_db;
USE cabs_db;

CREATE TABLE tbl_users (
    idnum INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    role ENUM('student','admin','guard') NOT NULL DEFAULT 'student'
);

CREATE TABLE tbl_vehicles (
    idnum INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    plate VARCHAR(20) NOT NULL UNIQUE,
    type VARCHAR(30) NOT NULL,
    brand VARCHAR(50) NOT NULL,
    color VARCHAR(30) NOT NULL,
    status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    date_applied TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES tbl_users(idnum)
);

CREATE TABLE tbl_gate_logs (
    idnum INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    guard_id INT NOT NULL,
    action ENUM('ENTRY','EXIT') NOT NULL,
    log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES tbl_vehicles(idnum),
    FOREIGN KEY (guard_id) REFERENCES tbl_users(idnum)
);

-- ready-made accounts (students sign up on their own)
INSERT INTO tbl_users (fullname,email,password,role) VALUES
('Administrator','admin@cabs.com','admin123','admin'),
('Security Guard','guard@cabs.com','guard123','guard');
