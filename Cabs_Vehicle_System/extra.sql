-- Run once:  mysql -u root < extra.sql
USE cabs_db;

CREATE TABLE IF NOT EXISTS tbl_visitor_logs (
    idnum INT AUTO_INCREMENT PRIMARY KEY,
    visitor_name VARCHAR(100) NOT NULL,
    plate VARCHAR(20) NOT NULL,
    id_shown VARCHAR(50) NOT NULL,
    contact VARCHAR(30) NOT NULL,
    person_visited VARCHAR(100) NOT NULL,
    purpose VARCHAR(150) NOT NULL,
    time_in TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_out TIMESTAMP NULL DEFAULT NULL,   -- NULL = visitor is still inside
    guard_in INT NOT NULL,
    guard_out INT NULL DEFAULT NULL,
    FOREIGN KEY (guard_in) REFERENCES tbl_users(idnum),
    FOREIGN KEY (guard_out) REFERENCES tbl_users(idnum)
);
