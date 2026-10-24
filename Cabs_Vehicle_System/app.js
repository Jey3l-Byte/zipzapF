const express = require('express');
const session = require('express-session');
const conn = require('./conn');
const app = express();

app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({extended:true}));
app.use(session({
    secret:'cabs_secret_key',
    resave:false,
    saveUninitialized:false
}));

// show an alert then go to another page
function alertGo(res, msg, url){
    res.send(
        `<script>
            alert('${msg}');
            location.href = '${url}';
        </script>`
    );
}

// only let a certain role open a page
function onlyFor(role){
    return (req,res,next)=>{
        if(req.session.user && req.session.user.role === role){
            return next();
        }
        alertGo(res,'PLEASE LOGIN FIRST!','/');
    };
}

/* ---------------- LOGIN / SIGNUP ---------------- */

app.get('/', (req,res)=>{
    res.render('login');
});

app.get('/signup', (req,res)=>{
    res.render('signup');
});

// student creates an account
app.post('/register', (req,res)=>{
    const fullname = req.body.fullname;
    const email = req.body.email;
    const pw = req.body.pw;

    const insert = `INSERT INTO tbl_users (fullname,email,password,role) VALUES(?,?,?,'student')`;

    conn.query(insert,[fullname,email,pw],(err)=>{
        if(err){
            if(err.code === 'ER_DUP_ENTRY'){
                return alertGo(res,'EMAIL ALREADY USED!','/signup');
            }
            throw err;
        }
        alertGo(res,'ACCOUNT CREATED! PLEASE LOGIN.','/');
    });
});

app.post('/login', (req,res)=>{
    const email = req.body.email;
    const pw = req.body.pw;

    const check = `SELECT * FROM tbl_users WHERE email = ? AND password = ?`;

    conn.query(check,[email,pw],(err,result)=>{
        if(err) throw err;
        if(result.length === 0){
            return alertGo(res,'WRONG EMAIL OR PASSWORD!','/');
        }

        const u = result[0];
        req.session.user = {idnum:u.idnum, fullname:u.fullname, role:u.role};

        if(u.role === 'admin') res.redirect('/admin');
        else if(u.role === 'guard') res.redirect('/guard');
        else res.redirect('/student');
    });
});

app.get('/logout', (req,res)=>{
    req.session.destroy(()=>{
        res.redirect('/');
    });
});

/* ---------------- STUDENT ---------------- */

// register vehicle form + own application status
app.get('/student', onlyFor('student'), (req,res)=>{
    const getdata = `SELECT * FROM tbl_vehicles WHERE owner_id = ? ORDER BY idnum DESC`;

    conn.query(getdata,[req.session.user.idnum],(err,result)=>{
        if(err) throw err;
        res.render('student',{
            user: req.session.user,
            vehicle: result
        });
    });
});

app.post('/vehicle', onlyFor('student'), (req,res)=>{
    const plate = req.body.plate.trim().toUpperCase();
    const type = req.body.type;
    const brand = req.body.brand;
    const color = req.body.color;

    const insert = `INSERT INTO tbl_vehicles (owner_id,plate,type,brand,color) VALUES(?,?,?,?,?)`;

    conn.query(insert,[req.session.user.idnum,plate,type,brand,color],(err)=>{
        if(err){
            if(err.code === 'ER_DUP_ENTRY'){
                return alertGo(res,'PLATE NUMBER ALREADY REGISTERED!','/student');
            }
            throw err;
        }
        alertGo(res,'VEHICLE SUBMITTED! WAIT FOR APPROVAL.','/student');
    });
});

/* ---------------- ADMIN ---------------- */

app.get('/admin', onlyFor('admin'), (req,res)=>{
    const getdata = `SELECT v.*, u.fullname
                     FROM tbl_vehicles v
                     JOIN tbl_users u ON v.owner_id = u.idnum
                     ORDER BY FIELD(v.status,'Pending','Approved','Rejected'), v.idnum DESC`;

    conn.query(getdata,(err,result)=>{
        if(err) throw err;
        res.render('admin',{
            user: req.session.user,
            vehicle: result
        });
    });
});

app.get('/review/:id/:status', onlyFor('admin'), (req,res)=>{
    const id = req.params.id;
    const status = req.params.status;

    if(status !== 'Approved' && status !== 'Rejected'){
        return alertGo(res,'INVALID STATUS!','/admin');
    }

    const update = `UPDATE tbl_vehicles SET status = ? WHERE idnum = ?`;

    conn.query(update,[status,id],(err)=>{
        if(err) throw err;
        alertGo(res,'VEHICLE ' + status.toUpperCase() + '!','/admin');
    });
});

/* ---------------- SECURITY GUARD ---------------- */

// search plate number, check approval, show recent gate logs
app.get('/guard', onlyFor('guard'), (req,res)=>{
    const plate = (req.query.plate || '').trim().toUpperCase();

    const getlogs = `SELECT l.*, v.plate
                     FROM tbl_gate_logs l
                     JOIN tbl_vehicles v ON l.vehicle_id = v.idnum
                     ORDER BY l.idnum DESC LIMIT 10`;

    conn.query(getlogs,(err,logs)=>{
        if(err) throw err;

        // nothing searched yet
        if(plate === ''){
            return res.render('guard',{
                user:req.session.user, plate:'', searched:false,
                vehicle:null, lastAction:null, logs:logs
            });
        }

        const find = `SELECT v.*, u.fullname
                      FROM tbl_vehicles v
                      JOIN tbl_users u ON v.owner_id = u.idnum
                      WHERE v.plate = ?`;

        conn.query(find,[plate],(err,result)=>{
            if(err) throw err;

            if(result.length === 0){
                return res.render('guard',{
                    user:req.session.user, plate:plate, searched:true,
                    vehicle:null, lastAction:null, logs:logs
                });
            }

            const lastlog = `SELECT action FROM tbl_gate_logs
                             WHERE vehicle_id = ? ORDER BY idnum DESC LIMIT 1`;

            conn.query(lastlog,[result[0].idnum],(err,last)=>{
                if(err) throw err;
                res.render('guard',{
                    user:req.session.user, plate:plate, searched:true,
                    vehicle:result[0],
                    lastAction: last.length > 0 ? last[0].action : null,
                    logs:logs
                });
            });
        });
    });
});

// record entry or exit
app.get('/gate/:id/:action', onlyFor('guard'), (req,res)=>{
    const id = req.params.id;
    const action = req.params.action;

    if(action !== 'ENTRY' && action !== 'EXIT'){
        return alertGo(res,'INVALID ACTION!','/guard');
    }

    conn.query(`SELECT plate, status FROM tbl_vehicles WHERE idnum = ?`,[id],(err,result)=>{
        if(err) throw err;
        if(result.length === 0){
            return alertGo(res,'VEHICLE NOT FOUND!','/guard');
        }

        const back = '/guard?plate=' + encodeURIComponent(result[0].plate);

        // verify approval first
        if(result[0].status !== 'Approved'){
            return alertGo(res,'VEHICLE IS NOT APPROVED!',back);
        }

        const lastlog = `SELECT action FROM tbl_gate_logs
                         WHERE vehicle_id = ? ORDER BY idnum DESC LIMIT 1`;

        conn.query(lastlog,[id],(err,last)=>{
            if(err) throw err;

            const lastAction = last.length > 0 ? last[0].action : null;

            if(action === 'ENTRY' && lastAction === 'ENTRY'){
                return alertGo(res,'VEHICLE IS ALREADY INSIDE!',back);
            }
            if(action === 'EXIT' && lastAction !== 'ENTRY'){
                return alertGo(res,'VEHICLE IS NOT INSIDE!',back);
            }

            const insert = `INSERT INTO tbl_gate_logs (vehicle_id,guard_id,action) VALUES(?,?,?)`;

            conn.query(insert,[id,req.session.user.idnum,action],(err)=>{
                if(err) throw err;
                alertGo(res,action + ' RECORDED!',back);
            });
        });
    });
});

require('./extra')(app, conn, onlyFor, alertGo);
app.listen(5000);
